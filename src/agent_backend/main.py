"""FastAPI application for the Claude Agent backend."""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import httpx
import websockets
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .agent import AgentExecutor
from .models import (
    AgentResponse,
    CreateSessionRequest,
    ErrorResponse,
    SendMessageRequest,
    SessionInfo,
    SessionListResponse,
    UpdateSessionRequest,
)
from .session import SessionManager
from .view import get_view_manager, ViewManager
from .flow import get_flow_manager
from .preview import get_preview_manager

# Port configuration
API_PORT = 8000
PREVIEW_PORT_START = 4001
PREVIEW_PORT_END = 4100

# Static files directory (built frontend)
FRONTEND_DIST_DIR = Path(__file__).parent.parent.parent / "frontend" / "dist"
USE_STATIC_FRONTEND = FRONTEND_DIST_DIR.exists()

# Global session manager
session_manager: SessionManager | None = None

# Global HTTP client for proxying (reuses connections)
proxy_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    global session_manager, proxy_client
    session_manager = SessionManager()
    proxy_client = httpx.AsyncClient(timeout=60.0, limits=httpx.Limits(max_connections=100))
    
    # Print startup information
    print("\n" + "=" * 60)
    print("  Tier0 Appbuilder - Backend Server")
    print("=" * 60)
    print(f"  API Server:      http://localhost:{API_PORT}")
    if USE_STATIC_FRONTEND:
        print(f"  Frontend:        Built static files (embedded)")
        print(f"  Static Dir:      {FRONTEND_DIST_DIR}")
    else:
        print(f"  Frontend:        Development mode (needs npm run dev)")
    print(f"  Preview Ports:   {PREVIEW_PORT_START}-{PREVIEW_PORT_END}")
    print(f"  View Proxy:      /view/{{session_id}}/")
    print(f"  Flow Proxy:      /flow/")
    print("=" * 60 + "\n")
    
    # Start background cleanup task
    cleanup_task = asyncio.create_task(periodic_cleanup())
    
    yield
    
    # Cleanup preview servers (dev mode)
    preview_mgr = get_preview_manager()
    await preview_mgr.cleanup_all()

    # Cleanup view servers (build mode)
    view_mgr = get_view_manager()
    await view_mgr.cleanup_all()

    # Cleanup flow server (shared Node-RED)
    flow_mgr = get_flow_manager()
    await flow_mgr.stop_flow()
    
    # Close proxy client
    if proxy_client:
        await proxy_client.aclose()
    
    # Cleanup
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass


async def periodic_cleanup():
    """Periodically clean up inactive sessions."""
    while True:
        await asyncio.sleep(300)  # Run every 5 minutes
        if session_manager:
            await session_manager.cleanup_inactive_sessions(max_idle_minutes=60)
            await session_manager.recover_stuck_busy_sessions(max_busy_minutes=30)


async def _auto_start_preview_and_flow(session_id: str):
    """
    Auto-start preview server and import flow.json after conversation completes.
    This runs in background to not block the response stream.
    """
    try:
        if not session_manager:
            return
        
        session = await session_manager.get_session(session_id)
        if not session:
            return
        
        session_dir = session.working_directory
        
        # Check if there's a web project (has package.json)
        package_json_path = os.path.join(session_dir, "package.json")
        if not os.path.exists(package_json_path):
            return  # Not a web project, skip
        
        print(f"[AUTO] Detected web project in session {session_id}")
        
        # Auto-start preview server if not already running
        preview_mgr = get_preview_manager()
        status = await preview_mgr.get_status(session_id)
        
        if status is None or status.get("status") not in ("running", "starting"):
            print(f"[AUTO] Starting preview server for {session_id}...")
            try:
                await preview_mgr.start_preview(
                    session_id=session_id,
                    session_dir=session_dir,
                    hmr_host="appbuilder.m3rcyzzz.club",  # Default HMR host
                    hmr_client_port=443
                )
                print(f"[AUTO] Preview server started for {session_id}")
            except Exception as e:
                print(f"[AUTO] Failed to start preview: {e}")
        
        await _import_flow_json(session_id, session_dir, context="AUTO")
    except Exception as e:
        print(f"[AUTO] Error in auto-start: {e}")


def _find_flow_json(session_dir: str) -> str | None:
    flow_paths = [
        os.path.join(session_dir, "dist", "flow.json"),
        os.path.join(session_dir, "build", "flow.json"),
        os.path.join(session_dir, "flow.json"),
        os.path.join(session_dir, "public", "flow.json"),
    ]
    for path in flow_paths:
        if os.path.exists(path):
            return path
    return None


async def _import_flow_json(session_id: str, session_dir: str, context: str) -> None:
    flow_json_path = _find_flow_json(session_dir)
    if not flow_json_path:
        return
    print(f"[{context}] Found flow.json at {flow_json_path}, importing to Node-RED...")
    try:
        flow_mgr = get_flow_manager()
        result = await flow_mgr.import_flow_from_file(session_id, flow_json_path)
        if result.get("success"):
            print(f"[{context}] Flow imported: {result.get('message')}")
        else:
            print(f"[{context}] Flow import failed: {result.get('message')}")
    except Exception as e:
        print(f"[{context}] Error importing flow: {e}")


app = FastAPI(
    title="Claude Agent Backend",
    description="A multi-session Claude Agent backend with per-session working directories",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware for web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_session_manager() -> SessionManager:
    """Get the session manager instance."""
    if session_manager is None:
        raise HTTPException(status_code=503, detail="Service not initialized")
    return session_manager


# ============================================================================
# Session Management Endpoints
# ============================================================================

@app.post("/sessions", response_model=SessionInfo, tags=["Sessions"])
async def create_session(request: CreateSessionRequest) -> SessionInfo:
    """
    Create a new agent session with an automatically generated working directory.
    
    Each session maintains its own:
    - Isolated working directory (auto-created based on session_id)
    - Conversation history
    - Configuration (system prompt, allowed tools, model)
    
    The working directory is created at: `~/.claude-agent-sessions/{session_id}/`
    Each session can only operate within its own directory.
    """
    manager = get_session_manager()
    
    session = await manager.create_session(
        system_prompt=request.system_prompt,
        allowed_tools=request.allowed_tools,
        model=request.model,
        display_name=request.display_name,
    )
    
    return session.get_info()


@app.get("/sessions", response_model=SessionListResponse, tags=["Sessions"])
async def list_sessions(include_closed: bool = False) -> SessionListResponse:
    """
    List all active sessions.
    
    Optionally include closed sessions with the `include_closed` parameter.
    """
    manager = get_session_manager()
    sessions = await manager.list_sessions(include_closed=include_closed)
    
    return SessionListResponse(
        sessions=[s.get_info() for s in sessions],
        total=len(sessions)
    )


@app.get("/sessions/{session_id}", response_model=SessionInfo, tags=["Sessions"])
async def get_session(session_id: str) -> SessionInfo:
    """Get information about a specific session."""
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    return session.get_info()


@app.get("/sessions/{session_id}/uns", tags=["Sessions"])
async def get_uns(session_id: str) -> dict:
    """Get UNS data from the session's app directory."""
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    base_dir = Path(session.working_directory)
    candidates = [
        base_dir / "app" / "uns.json",
        base_dir / "app" / "UNS.json",
        base_dir / "uns.json",
        base_dir / "UNS.json",
    ]
    
    for path in candidates:
        if path.exists() and path.is_file():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to read UNS: {e}")
    
    # Fallback: search within the session directory (prefer shallowest match)
    matches: list[tuple[int, Path]] = []
    for path in base_dir.rglob("*.json"):
        if path.is_file() and path.name.lower() == "uns.json":
            rel_depth = len(path.relative_to(base_dir).parts)
            matches.append((rel_depth, path))
    if matches:
        matches.sort(key=lambda item: item[0])
        path = matches[0][1]
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read UNS: {e}")
    
    raise HTTPException(status_code=404, detail="UNS file not found in session directory")


@app.patch("/sessions/{session_id}", response_model=SessionInfo, tags=["Sessions"])
async def update_session(session_id: str, request: UpdateSessionRequest) -> SessionInfo:
    """Update session metadata such as display name."""
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    if request.display_name is not None:
        await manager.update_display_name(session_id, request.display_name)
    
    return session.get_info()


@app.post("/sessions/{session_id}/recover", response_model=SessionInfo, tags=["Sessions"])
async def recover_session(session_id: str, reset_sdk: bool = False) -> SessionInfo:
    """Recover a session stuck in BUSY state or otherwise blocked."""
    manager = get_session_manager()
    session = await manager.recover_session(session_id, reset_sdk=reset_sdk)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return session.get_info()


@app.delete("/sessions/{session_id}", tags=["Sessions"])
async def close_session(session_id: str, delete: bool = False, keep_directory: bool = False) -> dict:
    """
    Close or delete a session.
    
    By default, the session is closed but retained in memory.
    Set `delete=True` to completely remove the session AND its working directory.
    Set `keep_directory=True` to preserve the working directory when deleting.
    """
    manager = get_session_manager()
    
    if delete:
        success = await manager.delete_session(session_id, delete_directory=not keep_directory)
        action = "deleted (including working directory)" if not keep_directory else "deleted (directory preserved)"
    else:
        success = await manager.close_session(session_id)
        action = "closed"
    
    if not success:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    return {"message": f"Session {session_id} {action}", "session_id": session_id}


# ============================================================================
# Chat Endpoints
# ============================================================================

@app.post("/sessions/{session_id}/chat", response_model=AgentResponse, tags=["Chat"])
async def send_message(session_id: str, request: SendMessageRequest) -> AgentResponse:
    """
    Send a message to an agent session and receive a response.
    
    The agent will execute in the session's working directory and can
    perform file operations, run commands, and more based on the
    session's configuration.
    """
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    if session.status.value == "closed":
        raise HTTPException(status_code=400, detail=f"Session {session_id} is closed")
    
    if session.status.value == "busy":
        raise HTTPException(status_code=409, detail=f"Session {session_id} is busy processing another request")
    
    executor = AgentExecutor(session)
    
    message = request.message
    if request.context:
        message = (
            "[Selected component context]\n"
            f"{request.context}\n\n"
            "[User request]\n"
            f"{request.message}"
        )
    
    try:
        response = await executor.execute(message)
        # Save session state after message
        await manager.save_session(session_id)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sessions/{session_id}/chat/stream", tags=["Chat"])
async def send_message_stream(session_id: str, request: SendMessageRequest):
    """
    Send a message and receive a streaming response.
    
    Returns a Server-Sent Events (SSE) stream with the agent's response.
    Each event contains a JSON object with the response chunk.
    """
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    if session.status.value == "closed":
        raise HTTPException(status_code=400, detail=f"Session {session_id} is closed")
    
    if session.status.value == "busy":
        raise HTTPException(status_code=409, detail=f"Session {session_id} is busy processing another request")
    
    executor = AgentExecutor(session)
    
    message = request.message
    if request.context:
        message = (
            "[Selected component context]\n"
            f"{request.context}\n\n"
            "[User request]\n"
            f"{request.message}"
        )
    
    async def event_generator() -> AsyncGenerator[str, None]:
        stream_gen = None
        try:
            stream_gen = executor.execute_stream(message)
            async for chunk in stream_gen:
                yield f"data: {json.dumps(chunk)}\n\n"
            # Save session state after streaming completes
            await manager.save_session(session_id)
            
            # Auto-start preview and import flow after conversation completes
            asyncio.create_task(_auto_start_preview_and_flow(session_id))
        except asyncio.CancelledError:
            # Client disconnected - the executor should still save the message
            print(f"[STREAM] Client disconnected for session {session_id}")
            if stream_gen is not None:
                try:
                    await stream_gen.aclose()
                except Exception:
                    pass
            await manager.save_session(session_id)
            raise
        except Exception as e:
            print(f"[STREAM] Error in stream: {e}")
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            await manager.save_session(session_id)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# ============================================================================
# Permission Endpoints
# ============================================================================

@app.get("/sessions/{session_id}/permissions", tags=["Permissions"])
async def get_pending_permissions(session_id: str) -> dict:
    """
    Get all pending permission requests for a session.
    
    These are tool executions waiting for user approval.
    """
    from .permissions import get_permission_manager
    
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    permission_mgr = get_permission_manager()
    pending = await permission_mgr.get_pending_requests(session_id)
    
    return {
        "session_id": session_id,
        "pending_requests": pending,
        "count": len(pending)
    }


@app.post("/sessions/{session_id}/permissions/{request_id}", tags=["Permissions"])
async def respond_to_permission(
    session_id: str, 
    request_id: str, 
    decision: str,  # "allow" or "deny"
    updated_input: dict | None = None
) -> dict:
    """
    Respond to a permission request.
    
    Args:
        session_id: The session ID
        request_id: The permission request ID
        decision: "allow" or "deny"
        updated_input: Optional modified input for the tool (only for "allow")
    
    Returns:
        Status of the response
    """
    from .permissions import get_permission_manager
    
    if decision not in ("allow", "deny"):
        raise HTTPException(status_code=400, detail="Decision must be 'allow' or 'deny'")
    
    permission_mgr = get_permission_manager()
    success = await permission_mgr.respond(
        request_id=request_id,
        decision=decision,  # type: ignore
        updated_input=updated_input
    )
    
    if not success:
        raise HTTPException(status_code=404, detail=f"Permission request {request_id} not found")
    
    return {
        "session_id": session_id,
        "request_id": request_id,
        "decision": decision,
        "success": True
    }


# ============================================================================
# History Endpoints
# ============================================================================

@app.get("/sessions/{session_id}/history", tags=["History"])
async def get_session_history(session_id: str, limit: int = 50, offset: int = 0) -> dict:
    """
    Get the conversation history for a session.
    
    Supports pagination with `limit` and `offset` parameters.
    """
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    messages = session.messages[offset:offset + limit]
    
    return {
        "session_id": session_id,
        "messages": [
            {
                "role": msg.role,
                "content": msg.content,
                "timestamp": msg.timestamp.isoformat(),
                "tool_use": msg.tool_use
            }
            for msg in messages
        ],
        "total": len(session.messages),
        "limit": limit,
        "offset": offset
    }


@app.delete("/sessions/{session_id}/history", tags=["History"])
async def clear_session_history(session_id: str) -> dict:
    """Clear the conversation history for a session."""
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    session.messages.clear()
    session.update_activity()
    
    return {"message": f"History cleared for session {session_id}", "session_id": session_id}


# ============================================================================
# Preview Server Endpoints
# ============================================================================

@app.post("/sessions/{session_id}/view/start", tags=["View"])
async def start_view(session_id: str, request: Request) -> dict:
    """
    Start a view server for the session's web project (build mode only).
    
    Builds the project and serves the static files.
    """
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    view_mgr = get_view_manager()
    server = await view_mgr.start_view(session_id, session.working_directory)
    
    # Use relative path for proxy URL (works with any domain/protocol)
    proxy_url = f"/view/{session_id}/" if server.status == 'running' else None
    
    return {
        'session_id': server.session_id,
        'port': server.port,
        'url': proxy_url,
        'local_url': f'http://localhost:{server.port}' if server.status == 'running' else None,
        'project_dir': server.project_dir,
        'status': server.status,
        'error': server.error,
        'package_ready': bool(server.package_path and os.path.exists(server.package_path)),
        'package_error': server.package_error
    }


@app.post("/sessions/{session_id}/view/stop", tags=["View"])
async def stop_view(session_id: str) -> dict:
    """Stop the view server for a session."""
    view_mgr = get_view_manager()
    success = await view_mgr.stop_view(session_id)
    
    return {
        'session_id': session_id,
        'stopped': success
    }


@app.get("/sessions/{session_id}/view/status", tags=["View"])
async def get_view_status(session_id: str, request: Request) -> dict:
    """Get the status of the view server for a session."""
    view_mgr = get_view_manager()
    status = await view_mgr.get_status(session_id)
    
    if status is None:
        return {
            'session_id': session_id,
            'status': 'not_started',
            'url': None,
            'local_url': None,
            'port': None,
            'project_dir': None,
            'error': None
        }
    
    # Use relative path for proxy URL (works with any domain/protocol)
    if status.get('status') == 'running':
        status['url'] = f"/view/{session_id}/"
        status['local_url'] = f"http://localhost:{status.get('port')}"
    
    return status


@app.get("/sessions/{session_id}/view/package", tags=["View"])
async def download_view_package(session_id: str) -> FileResponse:
    """Download the build package (frontend dist + UNS + flow)."""
    manager = get_session_manager()
    session = await manager.get_session(session_id)

    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    view_mgr = get_view_manager()
    package_path = await view_mgr.get_or_create_package(session_id, session.working_directory)

    if not package_path or not os.path.exists(package_path):
        raise HTTPException(status_code=404, detail="Build package not found")

    filename = f"{session_id}-build.zip"
    return FileResponse(package_path, filename=filename, media_type="application/zip")


# ============================================================================
# View Proxy (for public access through tunnel)
# ============================================================================

@app.api_route("/view/{session_id}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"], tags=["View"])
async def proxy_view(session_id: str, path: str, request: Request) -> Response:
    """
    Reverse proxy for view servers.
    
    This allows accessing view servers through the main API port,
    enabling public access when the API is exposed via tunnel.
    Injects <base> tag in HTML responses to fix relative paths.
    """
    view_mgr = get_view_manager()
    status = await view_mgr.get_status(session_id)
    
    if status is None or status.get('status') != 'running':
        raise HTTPException(status_code=503, detail="View server not running")
    
    port = status.get('port')
    if not port:
        raise HTTPException(status_code=503, detail="View server port not available")
    
    # Build mode always serves static files directly
    target_url = f"http://localhost:{port}/{path}"
    
    # Forward query parameters
    if request.query_params:
        target_url += f"?{request.query_params}"
    
    # Get request body for non-GET requests
    body = None
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        body = await request.body()
    
    # Forward headers (filter out hop-by-hop headers)
    # Keep accept-encoding so we don't ask for compressed content from static server
    headers = {}
    skip_headers = {'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding'}
    for key, value in request.headers.items():
        if key.lower() not in skip_headers:
            headers[key] = value
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                follow_redirects=False,
            )
            
            # Filter response headers (strip content-encoding to avoid decode mismatch)
            response_headers = {}
            skip_response_headers = {'transfer-encoding', 'connection', 'content-encoding'}
            for key, value in response.headers.items():
                if key.lower() not in skip_response_headers:
                    response_headers[key] = value
            
            # Prevent CDN caching to avoid encoding mismatch issues
            response_headers['cache-control'] = 'no-store, no-cache, must-revalidate'
            
            content = response.content
            content_type = response.headers.get('content-type', '')
            
            return Response(
                content=content,
                status_code=response.status_code,
                headers=response_headers,
                media_type=content_type or None,
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot connect to view server")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="View server timeout")


@app.get("/view/{session_id}", tags=["View"])
async def proxy_view_root(session_id: str, request: Request) -> Response:
    """Proxy root path for view."""
    return await proxy_view(session_id, "", request)


# ============================================================================
# Preview Server Endpoints (Dev Mode with HMR)
# ============================================================================

@app.post("/sessions/{session_id}/preview/start", tags=["Preview"])
async def start_preview(session_id: str, request: Request) -> dict:
    """
    Start a preview dev server for the session's web project.
    
    Uses Vite dev server with HMR for live reloading.
    """
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    # Determine HMR host from request headers
    # Try CF-Connecting-IP (Cloudflare), X-Forwarded-Host, then Host header
    host_header = (
        request.headers.get('cf-connecting-host') or 
        request.headers.get('x-forwarded-host') or 
        request.headers.get('host', 'localhost')
    )
    hmr_host = host_header.split(':')[0]  # Remove port if present
    
    # If localhost detected but coming through tunnel, use the known domain
    # Check for Cloudflare headers that indicate tunnel access
    is_cloudflare = request.headers.get('cf-ray') is not None or request.headers.get('cf-connecting-ip') is not None
    if is_cloudflare and hmr_host in ('localhost', '127.0.0.1'):
        hmr_host = 'appbuilder.m3rcyzzz.club'
    
    # Use 443 for HTTPS/tunnel, otherwise use the request port
    is_https = is_cloudflare or request.url.scheme == 'https' or 'appbuilder' in hmr_host or request.headers.get('x-forwarded-proto') == 'https'
    hmr_client_port = 443 if is_https else 8000
    
    preview_mgr = get_preview_manager()
    server = await preview_mgr.start_preview(
        session_id, 
        session.working_directory,
        hmr_host=hmr_host,
        hmr_client_port=hmr_client_port
    )

    if server.status in ("running", "starting"):
        await _import_flow_json(session_id, session.working_directory, context="PREVIEW")
    
    proxy_url = f"/preview/{session_id}/" if server.status == 'running' else None
    
    return {
        'session_id': server.session_id,
        'port': server.port,
        'url': proxy_url,
        'local_url': f'http://localhost:{server.port}' if server.status == 'running' else None,
        'project_dir': server.project_dir,
        'status': server.status,
        'error': server.error
    }


@app.post("/sessions/{session_id}/preview/stop", tags=["Preview"])
async def stop_preview(session_id: str) -> dict:
    """Stop the preview dev server for a session."""
    preview_mgr = get_preview_manager()
    success = await preview_mgr.stop_preview(session_id)
    
    return {
        'session_id': session_id,
        'stopped': success
    }


@app.get("/sessions/{session_id}/preview/status", tags=["Preview"])
async def get_preview_status(session_id: str, request: Request) -> dict:
    """Get the status of the preview dev server for a session."""
    preview_mgr = get_preview_manager()
    status = await preview_mgr.get_status(session_id)
    
    if status is None:
        return {
            'session_id': session_id,
            'status': 'not_started',
            'url': None,
            'local_url': None,
            'port': None,
            'project_dir': None,
            'error': None
        }
    
    if status.get('status') == 'running':
        status['url'] = f"/preview/{session_id}/"
        status['local_url'] = f"http://localhost:{status.get('port')}"
    
    return status


# ============================================================================
# Preview Proxy (Dev Mode with HMR)
# ============================================================================

@app.api_route("/preview/{session_id}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"], tags=["Preview"])
async def proxy_preview(session_id: str, path: str, request: Request) -> Response:
    """
    Reverse proxy for preview dev servers.
    
    Proxies HTTP requests to Vite dev server for live development.
    """
    preview_mgr = get_preview_manager()
    status = await preview_mgr.get_status(session_id)
    
    if status is None or status.get('status') != 'running':
        raise HTTPException(status_code=503, detail="Preview server not running")
    
    port = status.get('port')
    if not port:
        raise HTTPException(status_code=503, detail="Preview server port not available")
    
    # Vite has base set to /preview/{session_id}/, so we need to include it in the path
    target_url = f"http://localhost:{port}/preview/{session_id}/{path}"
    
    if request.query_params:
        target_url += f"?{request.query_params}"
    
    body = None
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        body = await request.body()
    
    headers = {}
    skip_headers = {'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding'}
    for key, value in request.headers.items():
        if key.lower() not in skip_headers:
            headers[key] = value
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                follow_redirects=False,
            )
            
            response_headers = {}
            skip_response_headers = {'transfer-encoding', 'connection'}
            for key, value in response.headers.items():
                if key.lower() not in skip_response_headers:
                    response_headers[key] = value
            
            # Don't cache dev server responses
            response_headers['cache-control'] = 'no-store, no-cache, must-revalidate'
            
            content = response.content
            content_type = response.headers.get('content-type', '')
            
            return Response(
                content=content,
                status_code=response.status_code,
                headers=response_headers,
                media_type=content_type or None,
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot connect to preview server")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Preview server timeout")


@app.get("/preview/{session_id}", tags=["Preview"])
async def proxy_preview_root(session_id: str, request: Request) -> Response:
    """Proxy root path for preview."""
    return await proxy_preview(session_id, "", request)


@app.websocket("/preview/{session_id}/{path:path}")
async def proxy_preview_websocket(websocket: WebSocket, session_id: str, path: str):
    """
    WebSocket proxy for Vite HMR (Hot Module Replacement).
    
    Forwards WebSocket connections to Vite dev server for live reloading.
    """
    preview_mgr = get_preview_manager()
    status = await preview_mgr.get_status(session_id)
    
    if status is None or status.get('status') != 'running':
        await websocket.close(code=1011, reason="Preview server not running")
        return
    
    port = status.get('port')
    if not port:
        await websocket.close(code=1011, reason="Preview server port not available")
        return
    
    # Build target WebSocket URL
    # Vite expects the base path for WebSocket connections
    target_url = f"ws://localhost:{port}/preview/{session_id}/{path}"
    if websocket.query_params:
        target_url += f"?{websocket.query_params}"
    
    print(f"[PREVIEW WS] Connecting to {target_url}")
    
    # Accept with the same subprotocol that the client requested (vite-hmr)
    subprotocols = websocket.headers.get("sec-websocket-protocol", "").split(",")
    subprotocols = [p.strip() for p in subprotocols if p.strip()]
    subprotocol = subprotocols[0] if subprotocols else None
    
    await websocket.accept(subprotocol=subprotocol)
    ws_backend = None
    
    try:
        # Connect to Vite with the same subprotocol
        ws_backend = await websockets.connect(
            target_url,
            subprotocols=[subprotocol] if subprotocol else None,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=10,
        )
        
        print(f"[PREVIEW WS] Connected to Vite HMR for session {session_id}")
        
        async def forward_to_backend():
            try:
                while True:
                    msg = await websocket.receive()
                    if msg["type"] == "websocket.receive":
                        if "text" in msg:
                            await ws_backend.send(msg["text"])
                        elif "bytes" in msg:
                            await ws_backend.send(msg["bytes"])
                    elif msg["type"] == "websocket.disconnect":
                        break
            except WebSocketDisconnect:
                pass
            except Exception as e:
                print(f"[PREVIEW WS] Forward to backend error: {e}")
        
        async def forward_to_client():
            try:
                async for message in ws_backend:
                    if isinstance(message, str):
                        await websocket.send_text(message)
                    else:
                        await websocket.send_bytes(message)
            except websockets.exceptions.ConnectionClosed:
                pass
            except Exception as e:
                print(f"[PREVIEW WS] Forward to client error: {e}")
        
        done, pending = await asyncio.wait(
            [
                asyncio.create_task(forward_to_backend()),
                asyncio.create_task(forward_to_client()),
            ],
            return_when=asyncio.FIRST_COMPLETED
        )
        
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
                
    except Exception as e:
        print(f"[PREVIEW WS] Error: {e}")
    finally:
        if ws_backend:
            try:
                await ws_backend.close()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/preview/{session_id}")
async def proxy_preview_websocket_root(websocket: WebSocket, session_id: str):
    """WebSocket proxy root path for preview."""
    await proxy_preview_websocket(websocket, session_id, "")


# ============================================================================
# Flow (Node-RED) Endpoints
# ============================================================================

@app.post("/flow/start", tags=["Flow"])
async def start_flow() -> dict:
    """Start the shared Node-RED flow server."""
    flow_mgr = get_flow_manager()
    server = await flow_mgr.start_flow()
    proxy_url = "/flow/" if server.status == "running" else None
    return {
        "status": server.status,
        "port": server.port,
        "url": proxy_url,
        "local_url": f"http://localhost:{server.port}" if server.status == "running" else None,
        "error": server.error,
        "managed": server.managed,
    }


@app.get("/flow/status", tags=["Flow"])
async def get_flow_status() -> dict:
    """Get the status of the shared Node-RED flow server."""
    flow_mgr = get_flow_manager()
    status = await flow_mgr.get_status()
    if status is None:
        return {
            "status": "not_started",
            "port": None,
            "url": None,
            "local_url": None,
            "error": None,
            "managed": False,
        }
    if status.get("status") == "running":
        status["url"] = "/flow/"
        status["local_url"] = f"http://localhost:{status.get('port')}"
    else:
        status["url"] = None
        status["local_url"] = None
    return status


# ============================================================================
# Flow Proxy (Node-RED)
# ============================================================================

@app.api_route("/flow/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"], tags=["Flow"])
async def proxy_flow(path: str, request: Request) -> Response:
    """
    Reverse proxy for the shared Node-RED instance.
    Uses streaming for large files and connection pooling for performance.
    """
    global proxy_client
    
    flow_mgr = get_flow_manager()
    server = await flow_mgr.start_flow()

    if server.status != "running":
        raise HTTPException(status_code=503, detail=server.error or "Flow server not running")

    # Node-RED is configured with httpAdminRoot "/flow", so always prefix /flow.
    if path:
        target_url = f"http://localhost:{server.port}/flow/{path}"
    else:
        target_url = f"http://localhost:{server.port}/flow/"

    if request.query_params:
        target_url += f"?{request.query_params}"

    body = None
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        body = await request.body()

    headers = {}
    skip_headers = {"host", "connection", "keep-alive", "transfer-encoding", "upgrade", "accept-encoding"}
    for key, value in request.headers.items():
        if key.lower() not in skip_headers:
            headers[key] = value

    # Ensure we have a client
    if proxy_client is None:
        proxy_client = httpx.AsyncClient(timeout=60.0, limits=httpx.Limits(max_connections=100))

    try:
        # Use streaming for potentially large responses
        async def stream_content():
            async with proxy_client.stream(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                follow_redirects=False,
            ) as response:
                # Build response headers
                response_headers = {}
                skip_response_headers = {"transfer-encoding", "connection", "content-encoding"}
                for key, value in response.headers.items():
                    if key.lower() not in skip_response_headers:
                        response_headers[key] = value
                
                # Allow caching for static assets (js, css, images)
                is_static = any(path.endswith(ext) for ext in ['.js', '.css', '.png', '.svg', '.woff', '.woff2', '.ttf', '.ico'])
                if is_static:
                    response_headers["cache-control"] = "public, max-age=31536000"
                else:
                    response_headers["cache-control"] = "no-store, no-cache, must-revalidate"
                
                yield response.status_code, response_headers, response.headers.get("content-type")
                
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    yield chunk

        # Get the generator
        gen = stream_content()
        first = await gen.__anext__()
        status_code, response_headers, content_type = first
        
        async def body_gen():
            async for chunk in gen:
                yield chunk
        
        return StreamingResponse(
            body_gen(),
            status_code=status_code,
            headers=response_headers,
            media_type=content_type or None,
        )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot connect to flow server")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Flow server timeout")


@app.get("/flow", tags=["Flow"])
async def proxy_flow_root(request: Request) -> Response:
    """Proxy root path for flow."""
    return await proxy_flow("", request)


@app.websocket("/flow/{path:path}")
async def proxy_flow_websocket(websocket: WebSocket, path: str):
    """
    WebSocket proxy for Node-RED comms endpoint.
    Node-RED uses WebSocket for real-time editor updates.
    """
    flow_mgr = get_flow_manager()
    server = await flow_mgr.start_flow()
    
    if server.status != "running":
        await websocket.close(code=1011, reason="Flow server not running")
        return
    
    # Build target WebSocket URL
    target_url = f"ws://localhost:{server.port}/flow/{path}"
    if websocket.query_params:
        target_url += f"?{websocket.query_params}"
    
    await websocket.accept()
    ws_backend = None
    
    try:
        ws_backend = await websockets.connect(
            target_url,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=10,
        )
        
        async def forward_to_backend():
            try:
                while True:
                    msg = await websocket.receive()
                    if msg["type"] == "websocket.receive":
                        if "text" in msg:
                            await ws_backend.send(msg["text"])
                        elif "bytes" in msg:
                            await ws_backend.send(msg["bytes"])
                    elif msg["type"] == "websocket.disconnect":
                        break
            except WebSocketDisconnect:
                pass
            except Exception:
                pass
        
        async def forward_to_client():
            try:
                async for message in ws_backend:
                    if isinstance(message, str):
                        await websocket.send_text(message)
                    else:
                        await websocket.send_bytes(message)
            except websockets.exceptions.ConnectionClosed:
                pass
            except Exception:
                pass
        
        # Run both directions concurrently, wait for first to complete
        done, pending = await asyncio.wait(
            [
                asyncio.create_task(forward_to_backend()),
                asyncio.create_task(forward_to_client()),
            ],
            return_when=asyncio.FIRST_COMPLETED
        )
        
        # Cancel pending tasks
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
                
    except Exception:
        pass
    finally:
        if ws_backend:
            try:
                await ws_backend.close()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass


# ============================================================================
# Health Check
# ============================================================================

@app.get("/health", tags=["System"])
async def health_check() -> dict:
    """Check the health of the service."""
    manager = get_session_manager()
    sessions = await manager.list_sessions()
    
    return {
        "status": "healthy",
        "active_sessions": len(sessions),
        "version": "0.1.0"
    }


# ============================================================================
# API Prefix Handler (for frontend requests with /api prefix)
# ============================================================================

@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"], tags=["API"])
async def api_prefix_handler(path: str, request: Request) -> Response:
    """
    Handle requests with /api prefix by forwarding to internal routes.
    This supports frontend requests that use /api prefix via Vite proxy config.
    Supports both regular and streaming responses.
    """
    # Build internal URL without /api prefix
    internal_url = f"http://localhost:8000/{path}"
    
    # Include query string
    if request.url.query:
        internal_url += f"?{request.url.query}"
    
    # Check if this is a streaming endpoint
    is_streaming = 'stream' in path
    
    try:
        # Get request body for POST/PUT/PATCH
        body = None
        if request.method in ('POST', 'PUT', 'PATCH'):
            body = await request.body()
        
        if is_streaming:
            # For streaming endpoints, use streaming response
            async def stream_generator():
                async with httpx.AsyncClient(timeout=600.0) as client:
                    async with client.stream(
                        method=request.method,
                        url=internal_url,
                        headers={k: v for k, v in request.headers.items() 
                                if k.lower() not in ('host', 'content-length')},
                        content=body,
                    ) as response:
                        async for chunk in response.aiter_bytes():
                            yield chunk
            
            return StreamingResponse(
                stream_generator(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                }
            )
        else:
            # For regular endpoints, use normal request
            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.request(
                    method=request.method,
                    url=internal_url,
                    headers={k: v for k, v in request.headers.items() 
                            if k.lower() not in ('host', 'content-length')},
                    content=body,
                )
                
                # Build response headers
                response_headers = dict(response.headers)
                response_headers.pop('content-encoding', None)
                response_headers.pop('transfer-encoding', None)
                response_headers.pop('content-length', None)
                
                return Response(
                    content=response.content,
                    status_code=response.status_code,
                    headers=response_headers,
                    media_type=response.headers.get('content-type'),
                )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Internal API error")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Internal API timeout")


# ============================================================================
# Frontend Static Files (Production Mode)
# ============================================================================

def serve_frontend_index() -> HTMLResponse:
    """Serve the frontend index.html file."""
    index_file = FRONTEND_DIST_DIR / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text(), status_code=200)
    raise HTTPException(status_code=404, detail="Frontend not built")


@app.get("/", tags=["Frontend"])
async def serve_root():
    """Serve the frontend root."""
    if USE_STATIC_FRONTEND:
        return serve_frontend_index()
    # Fallback: return simple message if no frontend
    return {"message": "Tier0 Appbuilder API", "docs": "/docs"}


@app.get("/{path:path}", tags=["Frontend"])
async def serve_frontend(path: str, request: Request):
    """
    Serve static frontend files or fallback to index.html for SPA routing.
    """
    if not USE_STATIC_FRONTEND:
        raise HTTPException(status_code=404, detail="Frontend not available in dev mode")
    
    # Skip API routes (already handled by other endpoints)
    if path.startswith(('sessions', 'health', 'preview', 'api', 'docs', 'openapi.json')):
        raise HTTPException(status_code=404, detail="Not found")
    
    # Check if file exists in dist
    file_path = FRONTEND_DIST_DIR / path
    
    if file_path.exists() and file_path.is_file():
        # Determine content type
        suffix = file_path.suffix.lower()
        content_types = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
        }
        media_type = content_types.get(suffix, 'application/octet-stream')
        # Add cache headers - short cache for dev, assets have content hash for cache busting
        headers = {"Cache-Control": "public, max-age=3600"} if suffix in ('.js', '.css') else {}
        return FileResponse(file_path, media_type=media_type, headers=headers)
    
    # For SPA: if path doesn't exist, serve index.html
    # This allows client-side routing to work
    return serve_frontend_index()


# ============================================================================
# CLI Entry Point
# ============================================================================

def main():
    """Run the server using uvicorn."""
    import uvicorn
    uvicorn.run(
        "agent_backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )


if __name__ == "__main__":
    main()
