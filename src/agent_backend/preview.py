"""Preview server management for session web projects."""

import asyncio
import os
import signal
import subprocess
from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class PreviewServer:
    """Represents a running preview server."""
    session_id: str
    port: int
    process: Optional[subprocess.Popen]
    project_dir: str
    status: str  # 'starting', 'running', 'stopped', 'error'
    error: Optional[str] = None


class PreviewManager:
    """Manages preview dev servers for session projects."""
    
    # Port range for preview servers
    PORT_START = 4001
    PORT_END = 4100
    
    def __init__(self):
        self._servers: Dict[str, PreviewServer] = {}
        self._used_ports: set[int] = set()
        self._lock = asyncio.Lock()
    
    def _find_available_port(self) -> int:
        """Find an available port in the range."""
        for port in range(self.PORT_START, self.PORT_END):
            if port not in self._used_ports:
                return port
        raise RuntimeError("No available ports for preview server")
    
    def _find_project_dir(self, working_directory: str) -> Optional[str]:
        """Find the web project directory within the session's working directory."""
        # Check common locations first
        candidates = [
            os.path.join(working_directory, "web"),
            os.path.join(working_directory, "frontend"),
            os.path.join(working_directory, "app"),
            working_directory,  # Fallback to root
        ]
        
        for candidate in candidates:
            package_json = os.path.join(candidate, "package.json")
            if os.path.exists(package_json):
                return candidate
        
        # Search for package.json in any subdirectory (one level deep)
        try:
            for item in os.listdir(working_directory):
                item_path = os.path.join(working_directory, item)
                if os.path.isdir(item_path) and not item.startswith('.'):
                    package_json = os.path.join(item_path, "package.json")
                    if os.path.exists(package_json):
                        return item_path
        except Exception:
            pass
        
        return None
    
    async def start_preview(self, session_id: str, working_directory: str) -> PreviewServer:
        """Start a preview server for a session."""
        async with self._lock:
            # Check if already running
            if session_id in self._servers:
                server = self._servers[session_id]
                if server.status == 'running' and server.process and server.process.poll() is None:
                    return server
                # Clean up dead server
                await self._stop_server(session_id)
            
            # Find project directory
            project_dir = self._find_project_dir(working_directory)
            if not project_dir:
                server = PreviewServer(
                    session_id=session_id,
                    port=0,
                    process=None,
                    project_dir=working_directory,
                    status='error',
                    error='No package.json found in working directory'
                )
                self._servers[session_id] = server
                return server
            
            # Check if node_modules exists, if not run npm install first
            node_modules = os.path.join(project_dir, "node_modules")
            if not os.path.exists(node_modules):
                try:
                    # Run npm install
                    install_process = await asyncio.create_subprocess_exec(
                        "npm", "install",
                        cwd=project_dir,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    await asyncio.wait_for(install_process.wait(), timeout=120)
                except Exception as e:
                    server = PreviewServer(
                        session_id=session_id,
                        port=0,
                        process=None,
                        project_dir=project_dir,
                        status='error',
                        error=f'Failed to install dependencies: {str(e)}'
                    )
                    self._servers[session_id] = server
                    return server
            
            # Allocate port
            port = self._find_available_port()
            self._used_ports.add(port)
            
            # Start the dev server
            try:
                env = os.environ.copy()
                env['PORT'] = str(port)
                
                # Try to start with npm run dev (add --host for Vite compatibility)
                process = subprocess.Popen(
                    ["npm", "run", "dev", "--", "--port", str(port), "--host", "0.0.0.0"],
                    cwd=project_dir,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    preexec_fn=os.setsid  # Create new process group
                )
                
                server = PreviewServer(
                    session_id=session_id,
                    port=port,
                    process=process,
                    project_dir=project_dir,
                    status='starting'
                )
                self._servers[session_id] = server
                
                # Wait a bit and check if process is still running
                await asyncio.sleep(2)
                
                if process.poll() is None:
                    server.status = 'running'
                else:
                    stderr = process.stderr.read().decode() if process.stderr else ''
                    server.status = 'error'
                    server.error = stderr[:500] if stderr else 'Process exited unexpectedly'
                    self._used_ports.discard(port)
                
                return server
                
            except Exception as e:
                self._used_ports.discard(port)
                server = PreviewServer(
                    session_id=session_id,
                    port=port,
                    process=None,
                    project_dir=project_dir,
                    status='error',
                    error=str(e)
                )
                self._servers[session_id] = server
                return server
    
    async def _stop_server(self, session_id: str) -> bool:
        """Internal method to stop a server (assumes lock is held)."""
        if session_id not in self._servers:
            return False
        
        server = self._servers[session_id]
        
        if server.process and server.process.poll() is None:
            try:
                # Kill the entire process group
                os.killpg(os.getpgid(server.process.pid), signal.SIGTERM)
                await asyncio.sleep(0.5)
                
                if server.process.poll() is None:
                    os.killpg(os.getpgid(server.process.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
            except Exception:
                pass
        
        self._used_ports.discard(server.port)
        server.status = 'stopped'
        server.process = None
        
        return True
    
    async def stop_preview(self, session_id: str) -> bool:
        """Stop a preview server for a session."""
        async with self._lock:
            result = await self._stop_server(session_id)
            if session_id in self._servers:
                del self._servers[session_id]
            return result
    
    async def get_status(self, session_id: str) -> Optional[dict]:
        """Get the status of a preview server."""
        async with self._lock:
            if session_id not in self._servers:
                return None
            
            server = self._servers[session_id]
            
            # Check if process is still running
            if server.process and server.process.poll() is not None:
                server.status = 'stopped'
                self._used_ports.discard(server.port)
            
            return {
                'session_id': server.session_id,
                'port': server.port,
                'url': f'http://localhost:{server.port}' if server.status == 'running' else None,
                'project_dir': server.project_dir,
                'status': server.status,
                'error': server.error
            }
    
    async def cleanup_all(self):
        """Stop all preview servers."""
        async with self._lock:
            for session_id in list(self._servers.keys()):
                await self._stop_server(session_id)
            self._servers.clear()
            self._used_ports.clear()


# Global preview manager instance
preview_manager: Optional[PreviewManager] = None


def get_preview_manager() -> PreviewManager:
    """Get or create the preview manager instance."""
    global preview_manager
    if preview_manager is None:
        preview_manager = PreviewManager()
    return preview_manager
