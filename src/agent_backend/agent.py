"""Agent wrapper for Claude Agent SDK."""

from typing import Any, AsyncGenerator, AsyncIterable, Callable, Awaitable

from claude_agent_sdk import ClaudeAgentOptions, query
from claude_agent_sdk.types import PermissionResultAllow, PermissionResultDeny, ToolPermissionContext

from .models import AgentResponse, SessionStatus
from .session import Session
from .permissions import get_permission_manager, PermissionRequest


# Callback type for permission requests
PermissionCallback = Callable[[PermissionRequest], Awaitable[None]]


async def single_prompt_iterable(prompt: str, session_id: str | None = None) -> AsyncIterable[dict[str, Any]]:
    """Convert a single prompt string to an AsyncIterable for streaming mode."""
    yield {
        "type": "user",
        "message": {"role": "user", "content": prompt},
        "parent_tool_use_id": None,
        "session_id": session_id,
    }


def create_permission_handler(
    session_id: str,
    on_permission_request: PermissionCallback | None = None
) -> Callable[[str, dict[str, Any], ToolPermissionContext], Awaitable[PermissionResultAllow | PermissionResultDeny]]:
    """Create a permission handler that can request user approval.
    
    Args:
        session_id: The session ID for this request
        on_permission_request: Optional callback to notify when a permission request is created
    
    Returns:
        A can_use_tool compatible function
    """
    async def handler(
        tool_name: str,
        tool_input: dict[str, Any],
        context: ToolPermissionContext
    ) -> PermissionResultAllow | PermissionResultDeny:
        print(f"[PERMISSION HANDLER] Called for tool: {tool_name}")
        
        # For now, auto-approve all tools to ensure the flow works
        # TODO: Enable interactive approval after confirming this works
        return PermissionResultAllow()
    
    return handler


class AgentExecutor:
    """Executes agent queries within a session context."""
    
    def __init__(self, session: Session):
        self.session = session
    
    def _enhance_system_prompt(self, base_prompt: str) -> str:
        """Enhance system prompt to ensure Agent references claude.md first."""
        enhanced_parts = []
        
        # Core instruction: always read claude.md first
        enhanced_parts.append(
            "IMPORTANT: Before starting any task, you MUST first read the `claude.md` file "
            "in your working directory. This file contains critical project guidelines, "
            "tech stack requirements, and coding standards you must follow. "
            "Do NOT ask the user questions - just read claude.md and follow its instructions."
        )
        
        # Add base prompt if provided
        if base_prompt:
            enhanced_parts.append(base_prompt)
        
        # Additional operational instructions
        enhanced_parts.append(
            "Additional rules:\n"
            "- Execute all tasks automatically without asking for permission or confirmation\n"
            "- Do not ask clarifying questions - make reasonable assumptions based on claude.md\n"
            "- Start implementation immediately after reading requirements"
        )
        
        return "\n\n".join(enhanced_parts)
    
    def _build_prompt_with_context(self, current_message: str) -> str:
        """Build a prompt that includes conversation history as context.
        
        This is used when the SDK session is not available (e.g., after restart).
        """
        # Only include context if we don't have a valid SDK session but have history
        if self.session.sdk_session_id or len(self.session.messages) == 0:
            return current_message
        
        # Build context from recent messages (limit to avoid token overflow)
        recent_messages = self.session.messages[-20:]  # Last 20 messages
        
        context_parts = ["[Previous conversation context]"]
        for msg in recent_messages:
            role = "User" if msg.role == "user" else "Assistant"
            # Truncate long messages
            content = msg.content[:500] + "..." if len(msg.content) > 500 else msg.content
            context_parts.append(f"{role}: {content}")
        
        context_parts.append("\n[Current request]")
        context_parts.append(current_message)
        
        return "\n".join(context_parts)
    
    def _build_options(
        self, 
        streaming: bool = False,
        permission_callback: PermissionCallback | None = None
    ) -> ClaudeAgentOptions:
        """Build ClaudeAgentOptions for the session.
        
        Args:
            streaming: Whether this is a streaming request
            permission_callback: Optional callback for permission requests (enables interactive approval)
        """
        options_kwargs: dict[str, Any] = {
            "cwd": self.session.working_directory,
            "model": self.session.model,
            "permission_mode": "bypassPermissions",  # Don't ask for permissions
        }
        
        # Build enhanced system prompt that references claude.md
        base_prompt = self.session.system_prompt or ""
        enhanced_prompt = self._enhance_system_prompt(base_prompt)
        if enhanced_prompt:
            options_kwargs["system_prompt"] = enhanced_prompt
        
        if self.session.allowed_tools:
            options_kwargs["allowed_tools"] = self.session.allowed_tools
        
        # Resume conversation if we have a previous SDK session
        if self.session.sdk_session_id:
            options_kwargs["resume"] = self.session.sdk_session_id
        
        # Enable partial messages for true streaming
        if streaming:
            options_kwargs["include_partial_messages"] = True
        
        return ClaudeAgentOptions(**options_kwargs)
    
    async def execute(self, message: str) -> AgentResponse:
        """Execute a query and return the complete response."""
        async with self.session._lock:
            self.session.status = SessionStatus.BUSY
        
        try:
            # Add user message to history
            self.session.add_message("user", message)
            
            options = self._build_options(streaming=False)
            
            # Build prompt with context if SDK session is not available
            prompt = self._build_prompt_with_context(message)
            
            response_text = ""
            tool_results: list[dict[str, Any]] = []
            
            # Execute query using AsyncIterable for can_use_tool support
            prompt_iterable = single_prompt_iterable(prompt, self.session.sdk_session_id)
            async for msg in query(prompt=prompt_iterable, options=options):
                msg_type = type(msg).__name__
                
                # Capture SDK session ID from SystemMessage for multi-turn conversation
                if msg_type == "SystemMessage":
                    if hasattr(msg, "data") and isinstance(msg.data, dict):
                        sdk_session_id = msg.data.get("session_id")
                        if sdk_session_id:
                            self.session.sdk_session_id = sdk_session_id
                
                elif msg_type == "AssistantMessage":
                    if hasattr(msg, "content") and msg.content:
                        for block in msg.content:
                            block_type = type(block).__name__
                            if block_type == "TextBlock":
                                response_text = getattr(block, "text", "")
                            elif block_type == "ToolUseBlock":
                                tool_results.append({
                                    "tool": getattr(block, "name", "unknown"),
                                    "input": getattr(block, "input", {}),
                                    "id": getattr(block, "id", ""),
                                })
                
                elif msg_type == "ToolResultMessage":
                    if hasattr(msg, "tool_use_id") and tool_results:
                        tool_use_id = msg.tool_use_id
                        for tool in tool_results:
                            if tool.get("id") == tool_use_id:
                                result_content = ""
                                if hasattr(msg, "content"):
                                    if isinstance(msg.content, str):
                                        result_content = msg.content
                                    elif isinstance(msg.content, list):
                                        for item in msg.content:
                                            if hasattr(item, "text"):
                                                result_content += item.text
                                tool["result"] = result_content
                                break
                
                elif msg_type == "ResultMessage":
                    if hasattr(msg, "result") and msg.result and not response_text:
                        response_text = msg.result
            
            # Add assistant message to history
            self.session.add_message(
                "assistant",
                response_text,
                tool_use=tool_results if tool_results else None
            )
            
            return AgentResponse(
                session_id=self.session.session_id,
                message=response_text,
                tool_results=tool_results if tool_results else None,
                is_complete=True
            )
        
        finally:
            async with self.session._lock:
                self.session.status = SessionStatus.ACTIVE
    
    async def execute_stream(self, message: str) -> AsyncGenerator[dict[str, Any], None]:
        """Execute a query and stream the response with character-level streaming.
        
        Permission requests are sent to the frontend via SSE events.
        Frontend can respond via /sessions/{id}/permissions/{request_id} API.
        """
        import asyncio
        
        async with self.session._lock:
            self.session.status = SessionStatus.BUSY
        
        # Queue for events (including permission requests)
        event_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        
        # Shared state
        response_text = ""
        thinking_text = ""
        tool_results: list[dict[str, Any]] = []
        query_error: Exception | None = None
        
        # Permission request callback - immediately puts event in queue
        async def on_permission_request(request: PermissionRequest) -> None:
            print(f"[PERMISSION] Request created: {request.tool_name} - {request.request_id}")
            await event_queue.put({
                "type": "permission_request",
                "request_id": request.request_id,
                "tool_name": request.tool_name,
                "tool_input": request.tool_input,
                "suggestions": request.suggestions,
                "session_id": self.session.session_id
            })
            print(f"[PERMISSION] Event queued for: {request.tool_name}")
        
        async def run_query() -> None:
            """Run query and put events into queue."""
            nonlocal response_text, thinking_text, tool_results, query_error
            current_tool_id: str | None = None
            last_save_time = asyncio.get_event_loop().time()
            last_heartbeat_time = asyncio.get_event_loop().time()
            SAVE_INTERVAL = 30.0  # Save partial response every 30 seconds
            HEARTBEAT_INTERVAL = 5.0  # Send heartbeat every 5 seconds
            
            try:
                # Add user message to history
                self.session.add_message("user", message)
                
                options = self._build_options(streaming=True, permission_callback=on_permission_request)
                prompt = self._build_prompt_with_context(message)
                prompt_iterable = single_prompt_iterable(prompt, self.session.sdk_session_id)
                
                async for msg in query(prompt=prompt_iterable, options=options):
                    current_time = asyncio.get_event_loop().time()
                    
                    # Send heartbeat to keep connection alive and show activity
                    if current_time - last_heartbeat_time >= HEARTBEAT_INTERVAL:
                        await event_queue.put({
                            "type": "heartbeat",
                            "session_id": self.session.session_id,
                            "response_length": len(response_text),
                            "tool_count": len(tool_results)
                        })
                        last_heartbeat_time = current_time
                    
                    # Periodic save of partial response
                    if current_time - last_save_time >= SAVE_INTERVAL and response_text:
                        print(f"[SAVE] Periodic save: {len(response_text)} chars, {len(tool_results)} tools")
                        # We don't actually save here to avoid duplicate messages,
                        # but we log to track progress
                        last_save_time = current_time
                    msg_type = type(msg).__name__
                    
                    # Capture SDK session ID
                    if msg_type == "SystemMessage":
                        if hasattr(msg, "data") and isinstance(msg.data, dict):
                            sdk_session_id = msg.data.get("session_id")
                            if sdk_session_id:
                                self.session.sdk_session_id = sdk_session_id
                    
                    # Handle streaming events
                    elif msg_type == "StreamEvent":
                        if hasattr(msg, "event") and isinstance(msg.event, dict):
                            event = msg.event
                            event_type = event.get("type", "")
                            
                            if event_type == "content_block_delta":
                                delta = event.get("delta", {})
                                delta_type = delta.get("type", "")
                                
                                if delta_type == "text_delta":
                                    text_chunk = delta.get("text", "")
                                    if text_chunk:
                                        response_text += text_chunk
                                        await event_queue.put({
                                            "type": "text_delta",
                                            "content": text_chunk,
                                            "session_id": self.session.session_id
                                        })
                                
                                elif delta_type == "thinking_delta":
                                    thinking_chunk = delta.get("thinking", "")
                                    if thinking_chunk:
                                        thinking_text += thinking_chunk
                                        await event_queue.put({
                                            "type": "thinking_delta",
                                            "content": thinking_chunk,
                                            "session_id": self.session.session_id
                                        })
                                
                                elif delta_type == "input_json_delta":
                                    json_chunk = delta.get("partial_json", "")
                                    if json_chunk:
                                        await event_queue.put({
                                            "type": "tool_input_delta",
                                            "content": json_chunk,
                                            "tool_id": current_tool_id,
                                            "session_id": self.session.session_id
                                        })
                            
                            elif event_type == "content_block_start":
                                content_block = event.get("content_block", {})
                                block_type = content_block.get("type", "")
                                
                                if block_type == "tool_use":
                                    tool_name = content_block.get("name", "unknown")
                                    tool_id = content_block.get("id", "")
                                    current_tool_id = tool_id
                                    tool_results.append({
                                        "tool": tool_name,
                                        "input": {},
                                        "id": tool_id,
                                    })
                                    await event_queue.put({
                                        "type": "tool_use_start",
                                        "content": {"tool": tool_name, "id": tool_id},
                                        "session_id": self.session.session_id
                                    })
                                
                                elif block_type == "thinking":
                                    await event_queue.put({
                                        "type": "thinking_start",
                                        "content": "",
                                        "session_id": self.session.session_id
                                    })
                            
                            elif event_type == "content_block_stop":
                                if current_tool_id:
                                    await event_queue.put({
                                        "type": "tool_use_end",
                                        "content": {"id": current_tool_id},
                                        "session_id": self.session.session_id
                                    })
                                    current_tool_id = None
                    
                    # Handle tool results
                    elif msg_type == "ToolResultMessage":
                        result_content = ""
                        if hasattr(msg, "content"):
                            if isinstance(msg.content, str):
                                result_content = msg.content
                            elif isinstance(msg.content, list):
                                for item in msg.content:
                                    if hasattr(item, "text"):
                                        result_content += item.text
                        
                        if hasattr(msg, "tool_use_id") and tool_results:
                            for tool in tool_results:
                                if tool.get("id") == msg.tool_use_id:
                                    tool["result"] = result_content
                                    break
                        
                        await event_queue.put({
                            "type": "tool_result",
                            "content": result_content,
                            "session_id": self.session.session_id
                        })
                    
                    # Final assistant message
                    elif msg_type == "AssistantMessage":
                        if hasattr(msg, "content") and msg.content:
                            for block in msg.content:
                                if type(block).__name__ == "ToolUseBlock":
                                    tool_id = getattr(block, "id", "")
                                    tool_input = getattr(block, "input", {})
                                    for tool in tool_results:
                                        if tool.get("id") == tool_id:
                                            tool["input"] = tool_input
                                            break
                
                # Save assistant message
                print(f"[SAVE] Saving assistant message: {len(response_text)} chars, {len(tool_results)} tools")
                self.session.add_message(
                    "assistant",
                    response_text,
                    tool_use=tool_results if tool_results else None,
                    thinking=thinking_text if thinking_text else None
                )
                print(f"[SAVE] Message saved successfully")
                
                await event_queue.put({
                    "type": "done",
                    "content": response_text,
                    "session_id": self.session.session_id,
                    "is_complete": True
                })
                
            except asyncio.CancelledError:
                # Task was cancelled (e.g., client disconnected)
                print(f"[SAVE] Task cancelled, saving partial response: {len(response_text)} chars")
                if response_text:
                    self.session.add_message(
                        "assistant",
                        response_text + "\n\n[Response interrupted - client disconnected]",
                        tool_use=tool_results if tool_results else None,
                        thinking=thinking_text if thinking_text else None
                    )
                await event_queue.put(None)
                return  # Exit cleanly
                
            except Exception as e:
                query_error = e
                print(f"[SAVE] Error occurred, saving partial response: {e}")
                if response_text:
                    self.session.add_message(
                        "assistant",
                        response_text + "\n\n[Response interrupted]",
                        tool_use=tool_results if tool_results else None,
                        thinking=thinking_text if thinking_text else None
                    )
                await event_queue.put({
                    "type": "error",
                    "content": str(e),
                    "session_id": self.session.session_id
                })
            finally:
                await event_queue.put(None)  # Signal end
        
        try:
            # Start query task
            query_task = asyncio.create_task(run_query())
            
            # Yield events from queue
            while True:
                event = await event_queue.get()
                if event is None:
                    break
                yield event
            
            # Wait for task to complete
            await query_task
            
            if query_error:
                raise query_error
                
        finally:
            async with self.session._lock:
                self.session.status = SessionStatus.ACTIVE
