"""View server management for session web projects (build mode only)."""

import asyncio
import json
import os
import shutil
import signal
import socket
import subprocess
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .flow import get_flow_manager


@dataclass
class ViewServer:
    """Represents a running view server."""
    session_id: str
    port: int
    process: Optional[subprocess.Popen]
    project_dir: str
    status: str  # 'building', 'running', 'stopped', 'error'
    error: Optional[str] = None
    candidates_found: List[str] = field(default_factory=list)


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
    
    def _has_build_script(self, project_dir: str) -> bool:
        """Check if package.json has a build script."""
        pkg = self._read_package_json(project_dir)
        if not pkg:
            return False
        scripts = pkg.get('scripts', {})
        return 'build' in scripts
    
    def _is_web_project(self, project_dir: str) -> bool:
        """Check if directory is a web project (has package.json with useful scripts or vite/react)."""
        pkg = self._read_package_json(project_dir)
        if not pkg:
            return False
        
        scripts = pkg.get('scripts', {})
        deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
        
        # Has build/dev/start script
        if any(s in scripts for s in ('build', 'dev', 'start')):
            return True
        
        # Has vite or react
        if any(d in deps for d in ('vite', 'react', 'vue', 'next', 'svelte')):
            return True
        
        return False
    
    def _find_project_dir(self, working_directory: str) -> tuple[Optional[str], List[str]]:
        """
        Find the web project directory within the session's working directory.
        Uses recursive traversal up to MAX_DEPTH levels.
        Returns (project_dir, all_candidates_found).
        """
        MAX_DEPTH = 4
        SKIP_DIRS = {'node_modules', '.git', '.vite', 'dist', 'build', '__pycache__', '.next'}
        
        candidates = []
        
        print(f"[VIEW] Searching for project in: {working_directory}")
        
        if not os.path.exists(working_directory):
            print(f"[VIEW] Working directory does not exist: {working_directory}")
            return None, []
        
        def recursive_search(current_dir: str, depth: int):
            """Recursively search for package.json files."""
            if depth > MAX_DEPTH:
                return
            
            try:
                # Check if current directory has package.json
                pkg_path = os.path.join(current_dir, "package.json")
                if os.path.exists(pkg_path):
                    candidates.append(current_dir)
                    rel_path = os.path.relpath(current_dir, working_directory)
                    print(f"[VIEW] Found candidate: {rel_path}")
                
                # Continue searching subdirectories
                for item in os.listdir(current_dir):
                    if item.startswith('.') or item in SKIP_DIRS:
                        continue
                    item_path = os.path.join(current_dir, item)
                    if os.path.isdir(item_path):
                        recursive_search(item_path, depth + 1)
            except PermissionError:
                pass
            except Exception as e:
                print(f"[VIEW] Error searching {current_dir}: {e}")
        
        # Start recursive search
        recursive_search(working_directory, 0)
        
        if not candidates:
            print(f"[VIEW] No package.json found (searched {MAX_DEPTH} levels deep)")
            # Check for static HTML
            if os.path.exists(os.path.join(working_directory, "index.html")):
                print(f"[VIEW] Found static index.html")
                return working_directory, [working_directory]
            return None, []
        
        # Sort candidates: prefer those with build scripts and web frameworks
        def score_candidate(path: str) -> int:
            score = 0
            if self._has_build_script(path):
                score += 10
            if self._is_web_project(path):
                score += 5
            # Prefer common names
            name = os.path.basename(path)
            if name in ('web', 'frontend', 'app', 'client'):
                score += 3
            # Prefer shallower paths (less nested = higher score)
            depth = path.replace(working_directory, '').count(os.sep)
            score -= depth * 2
            return score
        
        candidates.sort(key=score_candidate, reverse=True)
        
        best = candidates[0]
        print(f"[VIEW] Selected project: {best} (from {len(candidates)} candidates)")
        
        return best, candidates
    
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
            # Clean up any existing server for this session
            if session_id in self._servers:
                server = self._servers[session_id]
                # Only return existing if truly healthy
                if server.status == 'running' and server.process and server.process.poll() is None:
                    if self._is_port_in_use(server.port):
                        print(f"[VIEW] Reusing existing server for {session_id} on port {server.port}")
                        return server
                # Clean up old state
                await self._stop_server(session_id)
                del self._servers[session_id]
            
            # Find project directory
            project_dir, candidates = self._find_project_dir(working_directory)
            
            if not project_dir:
                error_msg = f'No package.json found. Searched in: {working_directory}'
                print(f"[VIEW] Error: {error_msg}")
                server = ViewServer(
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
            
            # Check if node_modules exists, if not run npm install first
            node_modules = os.path.join(project_dir, "node_modules")
            if not os.path.exists(node_modules):
                print(f"[VIEW] Installing dependencies for {session_id}...")
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
                        print(f"[VIEW] {error_msg}")
                        server = ViewServer(
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
                    print(f"[VIEW] {error_msg}")
                    server = ViewServer(
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
                    print(f"[VIEW] {error_msg}")
                    server = ViewServer(
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
            
            # Build and serve
            return await self._build_and_serve(session_id, project_dir, port, candidates)
    
    async def _import_session_flow(self, session_id: str, project_dir: str) -> None:
        """Import flow.json from dist directory to Node-RED if it exists."""
        # Check common dist locations for flow.json
        flow_paths = [
            os.path.join(project_dir, "dist", "flow.json"),
            os.path.join(project_dir, "build", "flow.json"),
            os.path.join(project_dir, "flow.json"),
        ]
        
        flow_json_path = None
        for path in flow_paths:
            if os.path.exists(path):
                flow_json_path = path
                break
        
        if not flow_json_path:
            print(f"[VIEW] No flow.json found for {session_id}")
            return
        
        print(f"[VIEW] Found flow.json at {flow_json_path}, importing to Node-RED...")
        
        try:
            flow_mgr = get_flow_manager()
            result = await flow_mgr.import_flow_from_file(session_id, flow_json_path)
            
            if result.get("success"):
                print(f"[VIEW] Flow imported successfully: {result.get('message')}")
            else:
                print(f"[VIEW] Flow import failed: {result.get('message')}")
        except Exception as e:
            print(f"[VIEW] Error importing flow: {e}")
    
    async def _build_and_serve(self, session_id: str, project_dir: str, port: int, candidates: List[str]) -> ViewServer:
        """Build project and start a static server."""
        server = ViewServer(
            session_id=session_id,
            port=port,
            process=None,
            project_dir=project_dir,
            status='building',
            candidates_found=candidates
        )
        self._servers[session_id] = server
        
        try:
            # Check if we have a build script
            if self._has_build_script(project_dir):
                max_retries = 3
                last_error = ""
                
                for attempt in range(max_retries):
                    # Clean dist directory before retry
                    if attempt > 0:
                        print(f"[VIEW] Retry {attempt + 1}/{max_retries} for {session_id}...")
                        for dir_name in ["dist", "build"]:
                            dir_path = os.path.join(project_dir, dir_name)
                            if os.path.exists(dir_path):
                                try:
                                    shutil.rmtree(dir_path)
                                except Exception as e:
                                    print(f"[VIEW] Failed to clean {dir_path}: {e}")
                        await asyncio.sleep(1)
                    
                    print(f"[VIEW] Building project for {session_id}..." + (f" (attempt {attempt + 1})" if attempt > 0 else ""))
                    
                    build_process = await asyncio.create_subprocess_exec(
                        "npm", "run", "build", "--", "--base=./",
                        cwd=project_dir,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    
                    try:
                        stdout, stderr = await asyncio.wait_for(build_process.communicate(), timeout=180)
                        
                        if build_process.returncode == 0:
                            print(f"[VIEW] Build succeeded for {session_id}")
                            # Try to import flow.json if it exists in dist
                            await self._import_session_flow(session_id, project_dir)
                            break
                        else:
                            last_error = stderr.decode()[:500]
                            print(f"[VIEW] Build failed (attempt {attempt + 1}): {last_error[:100]}...")
                            if attempt == max_retries - 1:
                                server.status = 'error'
                                server.error = f'Build failed after {max_retries} attempts: {last_error}'
                                self._used_ports.discard(port)
                                return server
                    except asyncio.TimeoutError:
                        last_error = 'Build timed out (180s)'
                        print(f"[VIEW] {last_error}")
                        if attempt == max_retries - 1:
                            server.status = 'error'
                            server.error = last_error
                            self._used_ports.discard(port)
                            return server
                
                # Find dist directory
                dist_dir = os.path.join(project_dir, "dist")
                if not os.path.exists(dist_dir):
                    dist_dir = os.path.join(project_dir, "build")
                if not os.path.exists(dist_dir):
                    # Check for .next (Next.js)
                    next_dir = os.path.join(project_dir, ".next")
                    if os.path.exists(next_dir):
                        dist_dir = project_dir  # Next.js serves from project root
                    else:
                        server.status = 'error'
                        server.error = 'Build completed but dist/build directory not found'
                        self._used_ports.discard(port)
                        return server
                
                serve_dir = dist_dir
            else:
                # No build script, serve the project directory directly (static site)
                print(f"[VIEW] No build script, serving directory directly: {project_dir}")
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
            port_ready = await self._verify_port_listening(port, timeout=15.0)
            
            if process.poll() is None and port_ready:
                server.status = 'running'
                print(f"[VIEW] Server started for {session_id} on port {port}")
            else:
                stderr_output = ""
                if process.poll() is not None:
                    try:
                        stderr_output = process.stderr.read().decode()[:200]
                    except:
                        pass
                server.status = 'error'
                server.error = f'Static server failed to start. {stderr_output}'
                self._used_ports.discard(port)
                print(f"[VIEW] Server failed to start: {server.error}")
            
            return server
            
        except Exception as e:
            self._used_ports.discard(port)
            server.status = 'error'
            server.error = str(e)
            print(f"[VIEW] Exception: {e}")
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
                print(f"[VIEW] Error stopping server: {e}")
        
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
                'error': server.error,
                'candidates_found': server.candidates_found
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
