"""View server management for session web projects (build mode only)."""

import asyncio
import os
import signal
import socket
import subprocess
from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class ViewServer:
    """Represents a running view server."""
    session_id: str
    port: int
    process: Optional[subprocess.Popen]
    project_dir: str
    status: str  # 'building', 'running', 'stopped', 'error'
    error: Optional[str] = None


class ViewManager:
    """Manages view servers for session projects (build mode only)."""
    
    PORT_START = 4001
    PORT_END = 4100
    
    def __init__(self):
        self._servers: Dict[str, ViewServer] = {}
        self._used_ports: set[int] = set()
        self._lock = asyncio.Lock()
    
    def _is_port_in_use(self, port: int) -> bool:
        """Check if a port is currently in use."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                result = s.connect_ex(('127.0.0.1', port))
                return result == 0
        except Exception:
            return False
    
    def _find_available_port(self) -> int:
        """Find an available port in the range."""
        for port in range(self.PORT_START, self.PORT_END):
            if port not in self._used_ports and not self._is_port_in_use(port):
                return port
        raise RuntimeError("No available ports for view server")
    
    def _has_build_script(self, project_dir: str) -> bool:
        """Check if package.json has a build script."""
        import json
        package_json_path = os.path.join(project_dir, "package.json")
        if not os.path.exists(package_json_path):
            return False
        try:
            with open(package_json_path, 'r') as f:
                pkg = json.load(f)
            scripts = pkg.get('scripts', {})
            return 'build' in scripts
        except Exception:
            return False
    
    def _find_project_dir(self, working_directory: str) -> Optional[str]:
        """Find the web project directory within the session's working directory."""
        candidates = []
        
        # Priority 1: Common subdirectory names
        for subdir in ["web", "frontend", "app"]:
            path = os.path.join(working_directory, subdir)
            if os.path.exists(os.path.join(path, "package.json")):
                candidates.append(path)
        
        # Priority 2: Any subdirectory with package.json (one level deep)
        try:
            for item in os.listdir(working_directory):
                item_path = os.path.join(working_directory, item)
                if os.path.isdir(item_path) and not item.startswith('.') and item not in ["node_modules"]:
                    if os.path.exists(os.path.join(item_path, "package.json")):
                        if item_path not in candidates:
                            candidates.append(item_path)
        except Exception:
            pass
        
        # Priority 3: Root directory
        if os.path.exists(os.path.join(working_directory, "package.json")):
            candidates.append(working_directory)
        
        # First, try to find a directory with build script
        for candidate in candidates:
            if self._has_build_script(candidate):
                return candidate
        
        # Fallback: return first candidate with package.json
        for candidate in candidates:
            if os.path.exists(os.path.join(candidate, "package.json")):
                return candidate
        
        # Last fallback: check for index.html in root (static site)
        if os.path.exists(os.path.join(working_directory, "index.html")):
            return working_directory
        
        return None
    
    async def _verify_port_listening(self, port: int, timeout: float = 10.0) -> bool:
        """Wait for a port to start listening."""
        start_time = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - start_time < timeout:
            if self._is_port_in_use(port):
                return True
            await asyncio.sleep(0.5)
        return False
    
    async def start_view(self, session_id: str, working_directory: str) -> ViewServer:
        """Start a view server for a session (always uses build mode)."""
        async with self._lock:
            # Check if already running
            if session_id in self._servers:
                server = self._servers[session_id]
                if server.status == 'running' and server.process and server.process.poll() is None:
                    if self._is_port_in_use(server.port):
                        return server
                await self._stop_server(session_id)
            
            # Find project directory
            project_dir = self._find_project_dir(working_directory)
            if not project_dir:
                server = ViewServer(
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
                    install_process = await asyncio.create_subprocess_exec(
                        "npm", "install",
                        cwd=project_dir,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    await asyncio.wait_for(install_process.wait(), timeout=120)
                except Exception as e:
                    server = ViewServer(
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
            
            # Build and serve
            return await self._build_and_serve(session_id, project_dir, port)
    
    async def _build_and_serve(self, session_id: str, project_dir: str, port: int) -> ViewServer:
        """Build project and start a static server."""
        server = ViewServer(
            session_id=session_id,
            port=port,
            process=None,
            project_dir=project_dir,
            status='building'
        )
        self._servers[session_id] = server
        
        try:
            # Check if we have a build script
            if self._has_build_script(project_dir):
                # Run npm build
                print(f"[VIEW] Building project for {session_id}...")
                build_process = await asyncio.create_subprocess_exec(
                    "npm", "run", "build",
                    cwd=project_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                
                try:
                    stdout, stderr = await asyncio.wait_for(build_process.communicate(), timeout=180)
                    
                    if build_process.returncode != 0:
                        server.status = 'error'
                        server.error = f'Build failed: {stderr.decode()[:500]}'
                        self._used_ports.discard(port)
                        return server
                except asyncio.TimeoutError:
                    server.status = 'error'
                    server.error = 'Build timed out (180s)'
                    self._used_ports.discard(port)
                    return server
                
                # Find dist directory
                dist_dir = os.path.join(project_dir, "dist")
                if not os.path.exists(dist_dir):
                    # Try build directory
                    dist_dir = os.path.join(project_dir, "build")
                if not os.path.exists(dist_dir):
                    server.status = 'error'
                    server.error = 'Build completed but dist/build directory not found'
                    self._used_ports.discard(port)
                    return server
                
                serve_dir = dist_dir
            else:
                # No build script, serve the project directory directly (static site)
                serve_dir = project_dir
            
            # Start static server using npx serve
            print(f"[VIEW] Starting static server for {session_id} on port {port}")
            process = subprocess.Popen(
                ["npx", "serve", "-s", serve_dir, "-l", str(port), "--cors", "--no-clipboard"],
                cwd=project_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                preexec_fn=os.setsid
            )
            
            server.process = process
            
            # Wait for server to start
            port_ready = await self._verify_port_listening(port, timeout=10.0)
            
            if process.poll() is None and port_ready:
                server.status = 'running'
                print(f"[VIEW] Server started for {session_id} on port {port}")
            else:
                server.status = 'error'
                server.error = 'Static server failed to start'
                self._used_ports.discard(port)
            
            return server
            
        except Exception as e:
            self._used_ports.discard(port)
            server.status = 'error'
            server.error = str(e)
            return server
    
    async def _stop_server(self, session_id: str) -> bool:
        """Internal method to stop a server (assumes lock is held)."""
        if session_id not in self._servers:
            return False
        
        server = self._servers[session_id]
        
        if server.process and server.process.poll() is None:
            try:
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
    
    async def stop_view(self, session_id: str) -> bool:
        """Stop a view server for a session."""
        async with self._lock:
            result = await self._stop_server(session_id)
            if session_id in self._servers:
                del self._servers[session_id]
            return result
    
    async def get_status(self, session_id: str) -> Optional[dict]:
        """Get the status of a view server."""
        async with self._lock:
            if session_id not in self._servers:
                return None
            
            server = self._servers[session_id]
            
            # Check if process is still running
            if server.process and server.process.poll() is not None:
                server.status = 'stopped'
                self._used_ports.discard(server.port)
            
            # Verify port is still listening
            if server.status == 'running' and not self._is_port_in_use(server.port):
                server.status = 'error'
                server.error = 'Server stopped unexpectedly'
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
        """Stop all view servers."""
        async with self._lock:
            for session_id in list(self._servers.keys()):
                await self._stop_server(session_id)
            self._servers.clear()
            self._used_ports.clear()


# Global view manager instance
view_manager: Optional[ViewManager] = None


def get_view_manager() -> ViewManager:
    """Get or create the view manager instance."""
    global view_manager
    if view_manager is None:
        view_manager = ViewManager()
    return view_manager
