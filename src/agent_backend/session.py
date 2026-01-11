"""Session management for the Claude Agent backend."""

import asyncio
import json
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .models import ChatMessage, SessionInfo, SessionStatus
from .database import SessionDatabase


class Session:
    """Represents a single agent session with its own working directory."""
    
    def __init__(
        self,
        session_id: str,
        working_directory: str,
        system_prompt: str | None = None,
        allowed_tools: list[str] | None = None,
        model: str = "claude-sonnet-4-20250514",
        created_at: datetime | None = None,
        last_activity: datetime | None = None,
        sdk_session_id: str | None = None,
        db: SessionDatabase | None = None,
    ):
        self.session_id = session_id
        self.working_directory = working_directory
        self.system_prompt = system_prompt
        self.allowed_tools = allowed_tools
        self.model = model
        self.status = SessionStatus.ACTIVE
        self.created_at = created_at or datetime.now()
        self.last_activity = last_activity or datetime.now()
        self.messages: list[ChatMessage] = []
        self.conversation_history: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()
        # SDK session ID for multi-turn conversation
        self.sdk_session_id = sdk_session_id
        # Database reference for incremental saves
        self._db = db
        
        # Create working directory for this session
        Path(working_directory).mkdir(parents=True, exist_ok=True)
    
    def delete_working_directory(self) -> bool:
        """Delete the session's working directory and all its contents."""
        try:
            if os.path.exists(self.working_directory):
                shutil.rmtree(self.working_directory)
                return True
            return False
        except Exception:
            return False
    
    def update_activity(self) -> None:
        """Update the last activity timestamp."""
        self.last_activity = datetime.now()
    
    def add_message(self, role: str, content: str, tool_use: list[dict[str, Any]] | None = None, thinking: str | None = None) -> ChatMessage:
        """Add a message to the session history."""
        message = ChatMessage(
            role=role,
            content=content,
            timestamp=datetime.now(),
            tool_use=tool_use,
            thinking=thinking
        )
        self.messages.append(message)
        self.update_activity()
        
        # Save message to database immediately
        if self._db:
            self._db.add_message(
                session_id=self.session_id,
                role=role,
                content=content,
                timestamp=message.timestamp.isoformat(),
                tool_use=tool_use,
                thinking=thinking
            )
        
        return message
    
    def get_info(self) -> SessionInfo:
        """Get session information."""
        return SessionInfo(
            session_id=self.session_id,
            working_directory=self.working_directory,
            status=self.status,
            created_at=self.created_at,
            last_activity=self.last_activity,
            message_count=len(self.messages),
            model=self.model
        )
    
    def close(self) -> None:
        """Close the session."""
        self.status = SessionStatus.CLOSED
        self.update_activity()
    
    def to_dict(self) -> dict[str, Any]:
        """Convert session to dictionary for persistence."""
        return {
            "session_id": self.session_id,
            "working_directory": self.working_directory,
            "system_prompt": self.system_prompt,
            "allowed_tools": self.allowed_tools,
            "model": self.model,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "last_activity": self.last_activity.isoformat(),
            "sdk_session_id": self.sdk_session_id,
            "messages": [
                {
                    "role": msg.role,
                    "content": msg.content,
                    "timestamp": msg.timestamp.isoformat(),
                    "tool_use": msg.tool_use,
                    "thinking": msg.thinking,
                }
                for msg in self.messages
            ],
        }
    
    @classmethod
    def from_dict(cls, data: dict[str, Any], db: SessionDatabase | None = None) -> "Session":
        """Create session from dictionary."""
        session = cls(
            session_id=data["session_id"],
            working_directory=data["working_directory"],
            system_prompt=data.get("system_prompt"),
            allowed_tools=data.get("allowed_tools"),
            model=data.get("model", "claude-sonnet-4-20250514"),
            created_at=datetime.fromisoformat(data["created_at"]),
            last_activity=datetime.fromisoformat(data["last_activity"]),
            sdk_session_id=data.get("sdk_session_id"),
            db=db,
        )
        session.status = SessionStatus(data.get("status", "active"))
        
        # Restore messages
        for msg_data in data.get("messages", []):
            message = ChatMessage(
                role=msg_data["role"],
                content=msg_data["content"],
                timestamp=datetime.fromisoformat(msg_data["timestamp"]),
                tool_use=msg_data.get("tool_use"),
                thinking=msg_data.get("thinking"),
            )
            session.messages.append(message)
        
        return session


class SessionManager:
    """Manages multiple agent sessions with SQLite persistence."""
    
    def __init__(self, base_workspace_dir: str | None = None):
        self._sessions: dict[str, Session] = {}
        self._lock = asyncio.Lock()
        # Use .sessions directory in the current working directory (project root)
        if base_workspace_dir:
            self.base_workspace_dir = base_workspace_dir
        else:
            # Default to .sessions in the project directory
            project_root = Path(__file__).parent.parent.parent
            self.base_workspace_dir = str(project_root / ".sessions")
        Path(self.base_workspace_dir).mkdir(parents=True, exist_ok=True)
        
        # Initialize SQLite database
        self._db = SessionDatabase(os.path.join(self.base_workspace_dir, "sessions.db"))
        
        # Load existing sessions on startup
        self._load_sessions()
    
    def _load_sessions(self) -> None:
        """Load sessions from SQLite database with migration and recovery."""
        try:
            # Step 1: Migrate from old JSON format if exists
            self._migrate_from_json()
            
            # Step 2: Load ALL sessions from database (including closed - user wants to see them)
            sessions_data = self._db.load_all_sessions(include_closed=True)
            
            for session_data in sessions_data:
                try:
                    session = Session.from_dict(session_data, db=self._db)
                    # Only load sessions whose working directory still exists
                    if os.path.exists(session.working_directory):
                        # Reactivate closed sessions - user should be able to continue
                        if session.status == SessionStatus.CLOSED:
                            session.status = SessionStatus.ACTIVE
                            self._save_session(session)
                        self._sessions[session.session_id] = session
                except Exception as e:
                    print(f"Warning: Failed to load session {session_data.get('session_id')}: {e}")
            
            # Step 3: Recover orphaned directories (exist on disk but not in DB)
            self._recover_orphaned_sessions()
            
            print(f"Loaded {len(self._sessions)} sessions from database")
        except Exception as e:
            print(f"Warning: Failed to load sessions: {e}")
    
    def _migrate_from_json(self) -> None:
        """Migrate sessions from old JSON format to SQLite."""
        json_path = os.path.join(self.base_workspace_dir, "_sessions.json")
        if not os.path.exists(json_path):
            return
        
        try:
            with open(json_path, 'r') as f:
                data = json.load(f)
            
            sessions_list = data.get("sessions", [])
            if not sessions_list:
                return
            
            migrated = 0
            for session_data in sessions_list:
                session_id = session_data.get("session_id")
                if session_id and not self._db.session_exists(session_id):
                    try:
                        self._db.save_session(session_data)
                        migrated += 1
                    except Exception as e:
                        print(f"Warning: Failed to migrate session {session_id}: {e}")
            
            if migrated > 0:
                print(f"Migrated {migrated} sessions from JSON to SQLite")
            
            # Clear the JSON sessions list after migration (keep file for backup)
            data["sessions"] = []
            data["migrated_to_sqlite"] = datetime.now().isoformat()
            with open(json_path, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Warning: Failed to migrate from JSON: {e}")
    
    def _recover_orphaned_sessions(self) -> None:
        """Recover sessions that exist on disk but not in database."""
        try:
            for item in os.listdir(self.base_workspace_dir):
                item_path = os.path.join(self.base_workspace_dir, item)
                # Skip non-directories and special files
                if not os.path.isdir(item_path) or item.startswith('_') or item.endswith('.db'):
                    continue
                
                session_id = item
                # Skip if already loaded
                if session_id in self._sessions:
                    continue
                
                # Skip if already in database
                if self._db.session_exists(session_id):
                    continue
                
                # Create a recovery session for this orphaned directory
                try:
                    session = Session(
                        session_id=session_id,
                        working_directory=item_path,
                        system_prompt="基于 claude.md 完成应用构建",
                        model="claude-sonnet-4-20250514",
                        created_at=datetime.fromtimestamp(os.path.getctime(item_path)),
                        last_activity=datetime.fromtimestamp(os.path.getmtime(item_path)),
                        db=self._db,
                    )
                    self._sessions[session_id] = session
                    self._db.save_session(session.to_dict())
                    print(f"Recovered orphaned session: {session_id}")
                except Exception as e:
                    print(f"Warning: Failed to recover session {session_id}: {e}")
        except Exception as e:
            print(f"Warning: Failed to scan for orphaned sessions: {e}")
    
    def _save_session(self, session: Session) -> None:
        """Save a single session to database."""
        try:
            self._db.save_session(session.to_dict())
        except Exception as e:
            print(f"Warning: Failed to save session {session.session_id}: {e}")
    
    def _copy_claude_md(self, working_directory: str) -> None:
        """Copy claude.md from project root to session's working directory.
        
        Always overwrites to ensure the latest version is used.
        """
        try:
            project_root = Path(__file__).parent.parent.parent
            source = project_root / "claude.md"
            dest = Path(working_directory) / "claude.md"
            
            if source.exists():
                shutil.copy2(source, dest)
                print(f"Copied claude.md to {working_directory}")
        except Exception as e:
            print(f"Warning: Failed to copy claude.md: {e}")
    
    async def create_session(
        self,
        system_prompt: str | None = None,
        allowed_tools: list[str] | None = None,
        model: str = "claude-sonnet-4-20250514",
    ) -> Session:
        """Create a new session with an automatically generated working directory."""
        session_id = str(uuid.uuid4())
        
        # Auto-generate working directory based on session_id
        working_directory = os.path.join(self.base_workspace_dir, session_id)
        working_directory = os.path.abspath(working_directory)
        
        session = Session(
            session_id=session_id,
            working_directory=working_directory,
            system_prompt=system_prompt,
            allowed_tools=allowed_tools,
            model=model,
            db=self._db,
        )
        
        # Copy claude.md from project root to session directory
        self._copy_claude_md(working_directory)
        
        async with self._lock:
            self._sessions[session_id] = session
            self._save_session(session)
        
        return session
    
    async def get_session(self, session_id: str) -> Session | None:
        """Get a session by ID."""
        async with self._lock:
            return self._sessions.get(session_id)
    
    async def list_sessions(self, include_closed: bool = False) -> list[Session]:
        """List all sessions."""
        async with self._lock:
            if include_closed:
                return list(self._sessions.values())
            return [s for s in self._sessions.values() if s.status != SessionStatus.CLOSED]
    
    async def close_session(self, session_id: str) -> bool:
        """Close a session."""
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.close()
                self._save_session(session)
                return True
            return False
    
    async def delete_session(self, session_id: str, delete_directory: bool = True) -> bool:
        """Delete a session completely, including its working directory."""
        async with self._lock:
            if session_id in self._sessions:
                session = self._sessions[session_id]
                
                # Delete working directory if requested
                if delete_directory:
                    session.delete_working_directory()
                
                del self._sessions[session_id]
                self._db.delete_session(session_id)
                return True
            return False
    
    async def save_session(self, session_id: str) -> bool:
        """Explicitly save a session's state."""
        async with self._lock:
            if session_id in self._sessions:
                self._save_session(self._sessions[session_id])
                return True
            return False
    
    async def update_sdk_session_id(self, session_id: str, sdk_session_id: str) -> bool:
        """Update SDK session ID for multi-turn conversations."""
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.sdk_session_id = sdk_session_id
                self._db.update_sdk_session_id(session_id, sdk_session_id)
                return True
            return False
    
    async def cleanup_inactive_sessions(self, max_idle_minutes: int = 60) -> int:
        """Clean up sessions that have been inactive for too long."""
        now = datetime.now()
        closed_count = 0
        
        async with self._lock:
            for session in self._sessions.values():
                if session.status != SessionStatus.CLOSED:
                    idle_time = (now - session.last_activity).total_seconds() / 60
                    if idle_time > max_idle_minutes:
                        session.close()
                        self._save_session(session)
                        closed_count += 1
        
        return closed_count
