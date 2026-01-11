"""Permission request management for interactive approval."""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from enum import Enum


class PermissionStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    TIMEOUT = "timeout"


@dataclass
class PermissionRequest:
    """Represents a permission request waiting for user approval."""
    request_id: str
    session_id: str
    tool_name: str
    tool_input: dict[str, Any]
    suggestions: list[str]
    created_at: datetime = field(default_factory=datetime.now)
    status: PermissionStatus = PermissionStatus.PENDING
    response_event: asyncio.Event = field(default_factory=asyncio.Event)
    user_decision: Literal["allow", "deny"] | None = None
    updated_input: dict[str, Any] | None = None


class PermissionManager:
    """Manages permission requests across sessions.
    
    This allows the agent to pause and wait for user approval
    before executing certain tools.
    """
    
    _instance: "PermissionManager | None" = None
    
    def __init__(self):
        self._pending_requests: dict[str, PermissionRequest] = {}
        self._lock = asyncio.Lock()
    
    @classmethod
    def get_instance(cls) -> "PermissionManager":
        """Get singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    async def create_request(
        self,
        session_id: str,
        tool_name: str,
        tool_input: dict[str, Any],
        suggestions: list[str] | None = None
    ) -> PermissionRequest:
        """Create a new permission request."""
        request_id = str(uuid.uuid4())
        request = PermissionRequest(
            request_id=request_id,
            session_id=session_id,
            tool_name=tool_name,
            tool_input=tool_input,
            suggestions=suggestions or []
        )
        
        async with self._lock:
            self._pending_requests[request_id] = request
        
        return request
    
    async def wait_for_response(
        self, 
        request: PermissionRequest, 
        timeout: float = 300.0  # 5 minutes default
    ) -> tuple[Literal["allow", "deny"], dict[str, Any] | None]:
        """Wait for user response to a permission request.
        
        Returns:
            Tuple of (decision, updated_input)
        """
        try:
            await asyncio.wait_for(request.response_event.wait(), timeout=timeout)
            return request.user_decision or "deny", request.updated_input
        except asyncio.TimeoutError:
            request.status = PermissionStatus.TIMEOUT
            return "deny", None
        finally:
            async with self._lock:
                self._pending_requests.pop(request.request_id, None)
    
    async def respond(
        self,
        request_id: str,
        decision: Literal["allow", "deny"],
        updated_input: dict[str, Any] | None = None
    ) -> bool:
        """Respond to a permission request."""
        async with self._lock:
            request = self._pending_requests.get(request_id)
            if not request:
                return False
            
            request.user_decision = decision
            request.updated_input = updated_input
            request.status = (
                PermissionStatus.APPROVED if decision == "allow" 
                else PermissionStatus.DENIED
            )
            request.response_event.set()
            return True
    
    async def get_pending_requests(self, session_id: str) -> list[dict[str, Any]]:
        """Get all pending requests for a session."""
        async with self._lock:
            return [
                {
                    "request_id": req.request_id,
                    "tool_name": req.tool_name,
                    "tool_input": req.tool_input,
                    "suggestions": req.suggestions,
                    "created_at": req.created_at.isoformat(),
                }
                for req in self._pending_requests.values()
                if req.session_id == session_id and req.status == PermissionStatus.PENDING
            ]
    
    async def cancel_session_requests(self, session_id: str) -> int:
        """Cancel all pending requests for a session."""
        cancelled = 0
        async with self._lock:
            to_remove = [
                req_id for req_id, req in self._pending_requests.items()
                if req.session_id == session_id
            ]
            for req_id in to_remove:
                req = self._pending_requests.pop(req_id)
                req.user_decision = "deny"
                req.status = PermissionStatus.DENIED
                req.response_event.set()
                cancelled += 1
        return cancelled


def get_permission_manager() -> PermissionManager:
    """Get the permission manager singleton."""
    return PermissionManager.get_instance()
