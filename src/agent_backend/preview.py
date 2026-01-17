"""Preview server management for session web projects (dev mode with HMR)."""

import asyncio
import json
import os
import signal
import socket
import subprocess
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class PreviewServer:
    """Represents a running preview dev server."""
    session_id: str
    port: int
    process: Optional[subprocess.Popen]
    project_dir: str
    status: str  # 'starting', 'running', 'stopped', 'error'
    error: Optional[str] = None
    candidates_found: List[str] = field(default_factory=list)


class PreviewManager:
    """Manages preview dev servers for session projects (dev mode with HMR)."""
    
    PORT_START = 5001
    PORT_END = 5100
    
    def __init__(self):
        self._servers: Dict[str, PreviewServer] = {}
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
        raise RuntimeError("No available ports for preview server")
    
    def _read_package_json(self, project_dir: str) -> Optional[dict]:
        """Read and parse package.json from a directory."""
        package_json_path = os.path.join(project_dir, "package.json")
        if not os.path.exists(package_json_path):
            return None
        try:
            with open(package_json_path, 'r') as f:
                return json.load(f)
        except Exception:
            return None
    
    def _has_dev_script(self, project_dir: str) -> bool:
        """Check if package.json has a dev script."""
        pkg = self._read_package_json(project_dir)
        if not pkg:
            return False
        scripts = pkg.get('scripts', {})
        return 'dev' in scripts
    
    def _is_web_project(self, project_dir: str) -> bool:
        """Check if directory is a web project."""
        pkg = self._read_package_json(project_dir)
        if not pkg:
            return False
        
        scripts = pkg.get('scripts', {})
        deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
        
        if any(s in scripts for s in ('build', 'dev', 'start')):
            return True
        
        if any(d in deps for d in ('vite', 'react', 'vue', 'next', 'svelte')):
            return True
        
        return False
    
    def _find_project_dir(self, working_directory: str) -> tuple[Optional[str], List[str]]:
        """Find the web project directory within the session's working directory."""
        MAX_DEPTH = 4
        SKIP_DIRS = {'node_modules', '.git', '.vite', 'dist', 'build', '__pycache__', '.next'}
        
        candidates = []
        
        print(f"[PREVIEW] Searching for project in: {working_directory}")
        
        if not os.path.exists(working_directory):
            print(f"[PREVIEW] Working directory does not exist: {working_directory}")
            return None, []
        
        def recursive_search(current_dir: str, depth: int):
            if depth > MAX_DEPTH:
                return
            
            try:
                pkg_path = os.path.join(current_dir, "package.json")
                if os.path.exists(pkg_path):
                    candidates.append(current_dir)
                    rel_path = os.path.relpath(current_dir, working_directory)
                    print(f"[PREVIEW] Found candidate: {rel_path}")
                
                for item in os.listdir(current_dir):
                    if item.startswith('.') or item in SKIP_DIRS:
                        continue
                    item_path = os.path.join(current_dir, item)
                    if os.path.isdir(item_path):
                        recursive_search(item_path, depth + 1)
            except PermissionError:
                pass
            except Exception as e:
                print(f"[PREVIEW] Error searching {current_dir}: {e}")
        
        recursive_search(working_directory, 0)
        
        if not candidates:
            print(f"[PREVIEW] No package.json found")
            return None, []
        
        def score_candidate(path: str) -> int:
            score = 0
            if self._has_dev_script(path):
                score += 10
            if self._is_web_project(path):
                score += 5
            name = os.path.basename(path)
            if name in ('web', 'frontend', 'app', 'client'):
                score += 3
            depth = path.replace(working_directory, '').count(os.sep)
            score -= depth * 2
            return score
        
        candidates.sort(key=score_candidate, reverse=True)
        best = candidates[0]
        print(f"[PREVIEW] Selected project: {best} (from {len(candidates)} candidates)")
        
        return best, candidates
    
    async def _verify_port_listening(self, port: int, timeout: float = 30.0) -> bool:
        """Wait for a port to start listening."""
        start_time = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - start_time < timeout:
            if self._is_port_in_use(port):
                return True
            await asyncio.sleep(0.5)
        return False
    
    async def start_preview(self, session_id: str, working_directory: str, hmr_host: str = "localhost", hmr_client_port: int = 443) -> PreviewServer:
        """Start a preview dev server for a session."""
        async with self._lock:
            # Check if already running
            if session_id in self._servers:
                server = self._servers[session_id]
                if server.status == 'running' and server.process and server.process.poll() is None:
                    if self._is_port_in_use(server.port):
                        print(f"[PREVIEW] Reusing existing server for {session_id} on port {server.port}")
                        return server
                await self._stop_server(session_id)
                del self._servers[session_id]
            
            # Find project directory
            project_dir, candidates = self._find_project_dir(working_directory)
            
            if not project_dir:
                error_msg = f'No package.json found. Searched in: {working_directory}'
                print(f"[PREVIEW] Error: {error_msg}")
                server = PreviewServer(
                    session_id=session_id,
                    port=0,
                    process=None,
                    project_dir=working_directory,
                    status='error',
                    error=error_msg,
                    candidates_found=candidates
                )
                self._servers[session_id] = server
                return server
            
            if not self._has_dev_script(project_dir):
                error_msg = 'No dev script found in package.json'
                print(f"[PREVIEW] Error: {error_msg}")
                server = PreviewServer(
                    session_id=session_id,
                    port=0,
                    process=None,
                    project_dir=project_dir,
                    status='error',
                    error=error_msg,
                    candidates_found=candidates
                )
                self._servers[session_id] = server
                return server
            
            # Check if node_modules exists
            node_modules = os.path.join(project_dir, "node_modules")
            if not os.path.exists(node_modules):
                print(f"[PREVIEW] Installing dependencies for {session_id}...")
                try:
                    install_process = await asyncio.create_subprocess_exec(
                        "npm", "install",
                        cwd=project_dir,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    stdout, stderr = await asyncio.wait_for(install_process.communicate(), timeout=180)
                    if install_process.returncode != 0:
                        error_msg = f'npm install failed: {stderr.decode()[:300]}'
                        print(f"[PREVIEW] {error_msg}")
                        server = PreviewServer(
                            session_id=session_id,
                            port=0,
                            process=None,
                            project_dir=project_dir,
                            status='error',
                            error=error_msg,
                            candidates_found=candidates
                        )
                        self._servers[session_id] = server
                        return server
                except asyncio.TimeoutError:
                    error_msg = 'npm install timed out (180s)'
                    print(f"[PREVIEW] {error_msg}")
                    server = PreviewServer(
                        session_id=session_id,
                        port=0,
                        process=None,
                        project_dir=project_dir,
                        status='error',
                        error=error_msg,
                        candidates_found=candidates
                    )
                    self._servers[session_id] = server
                    return server
                except Exception as e:
                    error_msg = f'Failed to install dependencies: {str(e)}'
                    print(f"[PREVIEW] {error_msg}")
                    server = PreviewServer(
                        session_id=session_id,
                        port=0,
                        process=None,
                        project_dir=project_dir,
                        status='error',
                        error=error_msg,
                        candidates_found=candidates
                    )
                    self._servers[session_id] = server
                    return server
            
            # Allocate port
            port = self._find_available_port()
            self._used_ports.add(port)
            
            # Start dev server
            return await self._start_dev_server(session_id, project_dir, port, candidates, hmr_host, hmr_client_port)
    
    async def _start_dev_server(
        self, 
        session_id: str, 
        project_dir: str, 
        port: int, 
        candidates: List[str],
        hmr_host: str,
        hmr_client_port: int
    ) -> PreviewServer:
        """Start Vite dev server with HMR configuration."""
        server = PreviewServer(
            session_id=session_id,
            port=port,
            process=None,
            project_dir=project_dir,
            status='starting',
            candidates_found=candidates
        )
        self._servers[session_id] = server
        
        try:
            # Set environment variables for HMR and base path configuration
            env = os.environ.copy()
            env['VITE_BASE'] = f'/preview/{session_id}/'
            env['VITE_HMR_PROTOCOL'] = 'wss'
            env['VITE_HMR_HOST'] = hmr_host
            env['VITE_HMR_CLIENT_PORT'] = str(hmr_client_port)
            
            print(f"[PREVIEW] Starting dev server for {session_id} on port {port}")
            print(f"[PREVIEW] Base path: /preview/{session_id}/")
            print(f"[PREVIEW] HMR config: wss://{hmr_host}:{hmr_client_port}/preview/{session_id}/")
            
            # Start npm run dev with port configuration
            process = subprocess.Popen(
                ["npm", "run", "dev", "--", "--port", str(port), "--host", "0.0.0.0", "--strictPort"],
                cwd=project_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                preexec_fn=os.setsid
            )
            
            server.process = process
            
            # Wait for server to start (dev server takes longer)
            port_ready = await self._verify_port_listening(port, timeout=30.0)
            
            if process.poll() is None and port_ready:
                server.status = 'running'
                print(f"[PREVIEW] Dev server started for {session_id} on port {port}")
            else:
                stderr_output = ""
                if process.poll() is not None:
                    try:
                        stderr_output = process.stderr.read().decode()[:500]
                    except:
                        pass
                server.status = 'error'
                server.error = f'Dev server failed to start. {stderr_output}'
                self._used_ports.discard(port)
                print(f"[PREVIEW] Dev server failed to start: {server.error}")
            
            return server
            
        except Exception as e:
            self._used_ports.discard(port)
            server.status = 'error'
            server.error = str(e)
            print(f"[PREVIEW] Exception: {e}")
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
            except Exception as e:
                print(f"[PREVIEW] Error stopping server: {e}")
        
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
            
            # Verify port is still listening
            if server.status == 'running' and not self._is_port_in_use(server.port):
                server.status = 'error'
                server.error = 'Dev server stopped unexpectedly'
                self._used_ports.discard(server.port)
            
            return {
                'session_id': server.session_id,
                'port': server.port,
                'url': f'http://localhost:{server.port}' if server.status == 'running' else None,
                'project_dir': server.project_dir,
                'status': server.status,
                'error': server.error,
                'candidates_found': server.candidates_found
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
