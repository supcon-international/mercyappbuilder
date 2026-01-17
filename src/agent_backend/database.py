"""SQLite database for session persistence."""

import json
import sqlite3
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from contextlib import contextmanager


class SessionDatabase:
    """SQLite-based session persistence.
    
    Uses a single SQLite file in the .sessions directory.
    No external dependencies - uses Python's built-in sqlite3.
    """
    
    def __init__(self, db_path: str | None = None):
        if db_path:
            self.db_path = db_path
        else:
            # Default to .sessions/sessions.db in project root
            project_root = Path(__file__).parent.parent.parent
            sessions_dir = project_root / ".sessions"
            sessions_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = str(sessions_dir / "sessions.db")
        
        self._init_db()
    
    @contextmanager
    def _get_conn(self):
        """Get a database connection with proper settings."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def _init_db(self):
        """Initialize database tables."""
        with self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    working_directory TEXT NOT NULL,
                    system_prompt TEXT,
                    allowed_tools TEXT,
                    model TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    last_activity TEXT NOT NULL,
                    sdk_session_id TEXT,
                    display_name TEXT
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    tool_use TEXT,
                    thinking TEXT,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                )
            """)
            
            # Create index for faster message queries
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_session 
                ON messages(session_id)
            """)

            # Backward-compatible migration for older databases
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(sessions)")}
            if "display_name" not in columns:
                conn.execute("ALTER TABLE sessions ADD COLUMN display_name TEXT")
    
    def save_session(self, session_data: dict[str, Any]) -> None:
        """Save or update a session."""
        with self._get_conn() as conn:
            # Upsert session
            conn.execute("""
                INSERT OR REPLACE INTO sessions 
                (session_id, working_directory, system_prompt, allowed_tools, 
                 model, status, created_at, last_activity, sdk_session_id, display_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session_data["session_id"],
                session_data["working_directory"],
                session_data.get("system_prompt"),
                json.dumps(session_data.get("allowed_tools")) if session_data.get("allowed_tools") else None,
                session_data["model"],
                session_data["status"],
                session_data["created_at"],
                session_data["last_activity"],
                session_data.get("sdk_session_id"),
                session_data.get("display_name"),
            ))
            
            # Delete existing messages and re-insert
            conn.execute("DELETE FROM messages WHERE session_id = ?", (session_data["session_id"],))
            
            for msg in session_data.get("messages", []):
                conn.execute("""
                    INSERT INTO messages (session_id, role, content, timestamp, tool_use, thinking)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    session_data["session_id"],
                    msg["role"],
                    msg["content"],
                    msg["timestamp"],
                    json.dumps(msg.get("tool_use")) if msg.get("tool_use") else None,
                    msg.get("thinking"),
                ))
    
    def load_session(self, session_id: str) -> dict[str, Any] | None:
        """Load a session by ID."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", 
                (session_id,)
            ).fetchone()
            
            if not row:
                return None
            
            session_data = dict(row)
            
            # Parse allowed_tools
            if session_data.get("allowed_tools"):
                session_data["allowed_tools"] = json.loads(session_data["allowed_tools"])
            
            # Load messages
            messages = conn.execute(
                "SELECT role, content, timestamp, tool_use, thinking FROM messages WHERE session_id = ? ORDER BY id",
                (session_id,)
            ).fetchall()
            
            session_data["messages"] = []
            for msg in messages:
                msg_data = {
                    "role": msg["role"],
                    "content": msg["content"],
                    "timestamp": msg["timestamp"],
                }
                if msg["tool_use"]:
                    msg_data["tool_use"] = json.loads(msg["tool_use"])
                if msg["thinking"]:
                    msg_data["thinking"] = msg["thinking"]
                session_data["messages"].append(msg_data)
            
            return session_data
    
    def load_all_sessions(self, include_closed: bool = False) -> list[dict[str, Any]]:
        """Load all sessions."""
        with self._get_conn() as conn:
            if include_closed:
                rows = conn.execute("SELECT session_id FROM sessions").fetchall()
            else:
                rows = conn.execute(
                    "SELECT session_id FROM sessions WHERE status != 'closed'"
                ).fetchall()
            
            sessions = []
            for row in rows:
                session = self.load_session(row["session_id"])
                if session:
                    sessions.append(session)
            
            return sessions
    
    def delete_session(self, session_id: str) -> bool:
        """Delete a session and its messages."""
        with self._get_conn() as conn:
            # Messages are deleted automatically via CASCADE
            result = conn.execute(
                "DELETE FROM sessions WHERE session_id = ?", 
                (session_id,)
            )
            return result.rowcount > 0
    
    def update_session_activity(self, session_id: str) -> None:
        """Update the last_activity timestamp."""
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE sessions SET last_activity = ? WHERE session_id = ?",
                (datetime.now().isoformat(), session_id)
            )
    
    def update_sdk_session_id(self, session_id: str, sdk_session_id: str) -> None:
        """Update the SDK session ID for multi-turn conversations."""
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE sessions SET sdk_session_id = ? WHERE session_id = ?",
                (sdk_session_id, session_id)
            )

    def update_display_name(self, session_id: str, display_name: str | None) -> None:
        """Update the display name for a session."""
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE sessions SET display_name = ? WHERE session_id = ?",
                (display_name, session_id)
            )
    
    def add_message(self, session_id: str, role: str, content: str, 
                    timestamp: str, tool_use: list | None = None, 
                    thinking: str | None = None) -> None:
        """Add a single message to a session."""
        with self._get_conn() as conn:
            conn.execute("""
                INSERT INTO messages (session_id, role, content, timestamp, tool_use, thinking)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                session_id,
                role,
                content,
                timestamp,
                json.dumps(tool_use) if tool_use else None,
                thinking,
            ))
            
            # Update session activity
            conn.execute(
                "UPDATE sessions SET last_activity = ? WHERE session_id = ?",
                (timestamp, session_id)
            )
    
    def session_exists(self, session_id: str) -> bool:
        """Check if a session exists."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM sessions WHERE session_id = ?", 
                (session_id,)
            ).fetchone()
            return row is not None
