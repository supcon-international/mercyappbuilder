"""Pydantic models for the agent backend API."""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SessionStatus(str, Enum):
    """Session status enumeration."""
    
    ACTIVE = "active"
    IDLE = "idle"
    BUSY = "busy"
    CLOSED = "closed"


class CreateSessionRequest(BaseModel):
    """Request model for creating a new session.
    
    Working directory is automatically created based on session_id.
    Each session can only work within its own isolated directory.
    """
    
    system_prompt: str | None = Field(
        default="基于 claude.md 完成应用构建",
        description="Optional custom system prompt for the agent"
    )
    allowed_tools: list[str] | None = Field(
        default=None,
        description="List of allowed tools for the agent"
    )
    model: str = Field(
        default="claude-sonnet-4-20250514",
        description="The Claude model to use"
    )


class SessionInfo(BaseModel):
    """Response model for session information."""
    
    session_id: str = Field(..., description="Unique session identifier")
    working_directory: str = Field(..., description="Working directory for this session")
    status: SessionStatus = Field(..., description="Current session status")
    created_at: datetime = Field(..., description="Session creation timestamp")
    last_activity: datetime = Field(..., description="Last activity timestamp")
    message_count: int = Field(default=0, description="Number of messages in session")
    model: str = Field(..., description="Claude model being used")


class ChatMessage(BaseModel):
    """Model for a chat message."""
    
    role: str = Field(..., description="Message role (user/assistant)")
    content: str = Field(..., description="Message content")
    timestamp: datetime = Field(default_factory=datetime.now, description="Message timestamp")
    tool_use: list[dict[str, Any]] | None = Field(
        default=None,
        description="Tool usage information if applicable"
    )
    thinking: str | None = Field(
        default=None,
        description="Agent's thinking process if available"
    )


class SendMessageRequest(BaseModel):
    """Request model for sending a message to a session."""
    
    message: str = Field(..., description="The message to send to the agent")
    stream: bool = Field(
        default=False,
        description="Whether to stream the response"
    )


class AgentResponse(BaseModel):
    """Response model for agent messages."""
    
    session_id: str = Field(..., description="Session ID")
    message: str = Field(..., description="Agent's response message")
    tool_results: list[dict[str, Any]] | None = Field(
        default=None,
        description="Results from any tool executions"
    )
    is_complete: bool = Field(
        default=True,
        description="Whether the response is complete"
    )


class ErrorResponse(BaseModel):
    """Error response model."""
    
    error: str = Field(..., description="Error message")
    detail: str | None = Field(default=None, description="Detailed error information")
    session_id: str | None = Field(default=None, description="Related session ID if applicable")


class SessionListResponse(BaseModel):
    """Response model for listing sessions."""
    
    sessions: list[SessionInfo] = Field(default_factory=list, description="List of sessions")
    total: int = Field(..., description="Total number of sessions")
