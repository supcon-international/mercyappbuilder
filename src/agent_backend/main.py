"""FastAPI application for the Claude Agent backend."""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Response
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
)
from .session import SessionManager
from .preview import get_preview_manager, PreviewManager

# Port configuration
API_PORT = 8000
PREVIEW_PORT_START = 4001
PREVIEW_PORT_END = 4100

# Static files directory (built frontend)
FRONTEND_DIST_DIR = Path(__file__).parent.parent.parent / "frontend" / "dist"
USE_STATIC_FRONTEND = FRONTEND_DIST_DIR.exists()

# Global session manager
session_manager: SessionManager | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    global session_manager
    session_manager = SessionManager()
    
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
    print(f"  Preview Proxy:   /preview/{{session_id}}/")
    print("=" * 60 + "\n")
    
    # Start background cleanup task
    cleanup_task = asyncio.create_task(periodic_cleanup())
    
    yield
    
    # Cleanup preview servers
    preview_mgr = get_preview_manager()
    await preview_mgr.cleanup_all()
    
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
    
    try:
        response = await executor.execute(request.message)
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
    
    async def event_generator() -> AsyncGenerator[str, None]:
        stream_gen = None
        try:
            stream_gen = executor.execute_stream(request.message)
            async for chunk in stream_gen:
                yield f"data: {json.dumps(chunk)}\n\n"
            # Save session state after streaming completes
            await manager.save_session(session_id)
        except asyncio.CancelledError:
            # Client disconnected - the executor should still save the message
            print(f"[STREAM] Client disconnected for session {session_id}")
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

@app.post("/sessions/{session_id}/preview/start", tags=["Preview"])
async def start_preview(session_id: str, request: Request, mode: str = 'dev') -> dict:
    """
    Start a preview server for the session's web project.
    
    Looks for a web project (package.json) in the session's working directory.
    
    Args:
        mode: 'dev' for development server (with HMR), 'build' for production build + static server
    """
    manager = get_session_manager()
    session = await manager.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    if mode not in ('dev', 'build'):
        raise HTTPException(status_code=400, detail="Mode must be 'dev' or 'build'")
    
    preview_mgr = get_preview_manager()
    server = await preview_mgr.start_preview(session_id, session.working_directory, mode=mode)
    
    # Use relative path for proxy URL (works with any domain/protocol)
    proxy_url = f"/preview/{session_id}/" if server.status == 'running' else None
    
    return {
        'session_id': server.session_id,
        'port': server.port,
        'url': proxy_url,
        'local_url': f'http://localhost:{server.port}' if server.status == 'running' else None,
        'project_dir': server.project_dir,
        'status': server.status,
        'mode': server.mode,
        'error': server.error,
        'verified_port': server.verified_port
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
    
    # Use relative path for proxy URL (works with any domain/protocol)
    if status.get('status') == 'running':
        status['url'] = f"/preview/{session_id}/"
        status['local_url'] = f"http://localhost:{status.get('port')}"
    
    return status


# ============================================================================
# Preview Proxy (for public access through tunnel)
# ============================================================================

@app.api_route("/preview/{session_id}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"], tags=["Preview"])
async def proxy_preview(session_id: str, path: str, request: Request) -> Response:
    """
    Reverse proxy for preview dev servers.
    
    This allows accessing preview servers through the main API port,
    enabling public access when the API is exposed via tunnel.
    Injects <base> tag in HTML responses to fix relative paths.
    """
    preview_mgr = get_preview_manager()
    status = await preview_mgr.get_status(session_id)
    
    if status is None or status.get('status') != 'running':
        raise HTTPException(status_code=503, detail="Preview server not running")
    
    port = status.get('port')
    if not port:
        raise HTTPException(status_code=503, detail="Preview server port not available")
    
    # Vite is started with --base=/preview/{session_id}/, so include full path
    target_url = f"http://localhost:{port}/preview/{session_id}/{path}"
    
    # Forward query parameters
    if request.query_params:
        target_url += f"?{request.query_params}"
    
    # Get request body for non-GET requests
    body = None
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        body = await request.body()
    
    # Forward headers (filter out hop-by-hop headers)
    headers = {}
    skip_headers = {'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'}
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
            
            # Filter response headers
            response_headers = {}
            skip_response_headers = {'transfer-encoding', 'connection', 'content-encoding'}
            for key, value in response.headers.items():
                if key.lower() not in skip_response_headers:
                    response_headers[key] = value
            
            content = response.content
            content_type = response.headers.get('content-type', '')
            
            # Note: Vite's --base flag handles path rewriting, no injection needed
            
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
