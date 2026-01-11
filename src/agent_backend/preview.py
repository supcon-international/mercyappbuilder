"""Preview server management for session web projects."""

import asyncio
import os
import signal
import socket
import subprocess
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class PreviewServer:
    """Represents a running preview server."""
    session_id: str
    port: int
    process: Optional[subprocess.Popen]
    project_dir: str
    status: str  # 'starting', 'running', 'stopped', 'error', 'building'
    mode: str = 'dev'  # 'dev' or 'build'
    project_type: str = 'unknown'  # 'vite', 'live-server', 'next', 'static', 'unknown'
    error: Optional[str] = None
    verified_port: bool = False


class PreviewManager:
    """Manages preview dev servers for session projects."""
    
    # Port range for preview servers
    PORT_START = 4001
    PORT_END = 4100
    
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
    
    def _has_dev_script(self, project_dir: str) -> bool:
        """Check if package.json has a dev script or is a valid project."""
        import json
        package_json_path = os.path.join(project_dir, "package.json")
        if not os.path.exists(package_json_path):
            return False
        try:
            with open(package_json_path, 'r') as f:
                pkg = json.load(f)
            scripts = pkg.get('scripts', {})
            # Check for dev, start, or serve scripts
            if any(key in scripts for key in ('dev', 'start', 'serve')):
                return True
            # Also check for vite in devDependencies (can run npx vite)
            deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
            if 'vite' in deps:
                return True
            return False
        except Exception:
            return False
    
    def _find_project_dir(self, working_directory: str) -> Optional[str]:
        """Find the web project directory within the session's working directory."""
        import json
        
        # Collect all candidates with priority
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
        
        # First, try to find a directory with dev script
        for candidate in candidates:
            if self._has_dev_script(candidate):
                return candidate
        
        # Fallback: return first candidate with package.json, even without dev script
        # (might be a static project that can use npx serve)
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
    
    async def start_preview(self, session_id: str, working_directory: str, mode: str = 'dev') -> PreviewServer:
        """Start a preview server for a session.
        
        Args:
            session_id: The session ID
            working_directory: The session's working directory
            mode: 'dev' for development server, 'build' for production build + static server
        """
        async with self._lock:
            # Check if already running
            if session_id in self._servers:
                server = self._servers[session_id]
                if server.status == 'running' and server.process and server.process.poll() is None:
                    # Verify the port is actually listening
                    if self._is_port_in_use(server.port):
                        server.verified_port = True
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
                    mode=mode,
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
                        mode=mode,
                        error=f'Failed to install dependencies: {str(e)}'
                    )
                    self._servers[session_id] = server
                    return server
            
            # Allocate port - ensure it's truly available
            port = self._find_available_port()
            self._used_ports.add(port)
            
            # Build mode: run npm build first, then serve static files
            if mode == 'build':
                return await self._start_build_preview(session_id, project_dir, port)
            
            # Dev mode: Start the dev server
            return await self._start_dev_preview(session_id, project_dir, port)
    
    def _detect_project_type(self, project_dir: str) -> str:
        """Detect the type of web project."""
        package_json_path = os.path.join(project_dir, "package.json")
        vite_config = os.path.join(project_dir, "vite.config.ts")
        vite_config_js = os.path.join(project_dir, "vite.config.js")
        index_html = os.path.join(project_dir, "index.html")
        
        # Check for Vite
        if os.path.exists(vite_config) or os.path.exists(vite_config_js):
            return 'vite'
        
        # Check package.json for hints
        if os.path.exists(package_json_path):
            try:
                import json
                with open(package_json_path, 'r') as f:
                    pkg = json.load(f)
                
                deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
                scripts = pkg.get('scripts', {})
                
                # Check for Vite in dependencies
                if 'vite' in deps:
                    return 'vite'
                
                # Check for live-server
                if 'live-server' in deps:
                    return 'live-server'
                
                # Check scripts for hints
                dev_script = scripts.get('dev', '')
                if 'vite' in dev_script:
                    return 'vite'
                if 'live-server' in dev_script:
                    return 'live-server'
                
                # Check for Next.js
                if 'next' in deps:
                    return 'next'
                
            except Exception:
                pass
        
        # Fallback: if there's just an index.html, use simple static server
        if os.path.exists(index_html):
            return 'static'
        
        return 'unknown'
    
    async def _start_dev_preview(self, session_id: str, project_dir: str, port: int) -> PreviewServer:
        """Start a development preview server."""
        try:
            env = os.environ.copy()
            env['PORT'] = str(port)
            
            # Detect project type
            project_type = self._detect_project_type(project_dir)
            print(f"[PREVIEW] Detected project type: {project_type} for {session_id}")
            
            base_path = f"/preview/{session_id}/"
            
            if project_type == 'vite':
                # Vite project: use npm run dev with Vite-specific args
                cmd = ["npm", "run", "dev", "--", "--port", str(port), "--host", "0.0.0.0", "--base", base_path]
            elif project_type == 'live-server':
                # Live-server project: use npx live-server directly
                cmd = ["npx", "live-server", "--port=" + str(port), "--host=0.0.0.0", "--no-browser"]
            elif project_type == 'next':
                # Next.js project
                cmd = ["npm", "run", "dev", "--", "-p", str(port), "-H", "0.0.0.0"]
            elif project_type == 'static':
                # Static HTML: use npx serve
                cmd = ["npx", "serve", "-l", str(port), "-s", ".", "--cors"]
            else:
                # Try generic npm run dev
                cmd = ["npm", "run", "dev", "--", "--port", str(port), "--host", "0.0.0.0"]
            
            process = subprocess.Popen(
                cmd,
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
                status='starting',
                mode='dev',
                project_type=project_type
            )
            self._servers[session_id] = server
            
            # Wait for server to start and verify port is listening
            port_ready = await self._verify_port_listening(port, timeout=15.0)
            
            if process.poll() is None and port_ready:
                server.status = 'running'
                server.verified_port = True
                print(f"[PREVIEW] Dev server started for {session_id} on port {port}")
            elif process.poll() is not None:
                stderr = process.stderr.read().decode() if process.stderr else ''
                server.status = 'error'
                server.error = stderr[:500] if stderr else 'Process exited unexpectedly'
                self._used_ports.discard(port)
            else:
                # Process is running but port not ready
                server.status = 'error'
                server.error = 'Server started but port not responding'
                # Try to kill the process
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                except Exception:
                    pass
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
                mode='dev',
                error=str(e)
            )
            self._servers[session_id] = server
            return server
    
    async def _start_build_preview(self, session_id: str, project_dir: str, port: int) -> PreviewServer:
        """Build project and start a static preview server."""
        try:
            # First, run npm build
            server = PreviewServer(
                session_id=session_id,
                port=port,
                process=None,
                project_dir=project_dir,
                status='building',
                mode='build'
            )
            self._servers[session_id] = server
            
            build_process = await asyncio.create_subprocess_exec(
                "npm", "run", "build",
                cwd=project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            try:
                _, stderr = await asyncio.wait_for(build_process.communicate(), timeout=120)
                
                if build_process.returncode != 0:
                    server.status = 'error'
                    server.error = f'Build failed: {stderr.decode()[:500]}'
                    self._used_ports.discard(port)
                    return server
            except asyncio.TimeoutError:
                server.status = 'error'
                server.error = 'Build timed out'
                self._used_ports.discard(port)
                return server
            
            # Find dist directory
            dist_dir = os.path.join(project_dir, "dist")
            if not os.path.exists(dist_dir):
                server.status = 'error'
                server.error = 'Build completed but dist directory not found'
                self._used_ports.discard(port)
                return server
            
            # Start a simple static server using npx serve
            base_path = f"/preview/{session_id}"
            process = subprocess.Popen(
                ["npx", "serve", "-s", dist_dir, "-l", str(port), "--cors"],
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
                server.verified_port = True
                print(f"[PREVIEW] Build server started for {session_id} on port {port}")
            else:
                server.status = 'error'
                server.error = 'Static server failed to start'
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
                mode='build',
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
                # Check if there's a project directory
                manager_module = __import__('src.agent_backend.session', fromlist=['SessionManager'])
                # We can't access session manager here, just return None
                return None
            
            server = self._servers[session_id]
            
            # Check if process is still running
            if server.process and server.process.poll() is not None:
                server.status = 'stopped'
                server.verified_port = False
                self._used_ports.discard(server.port)
            
            # Verify port is still listening
            if server.status == 'running' and not self._is_port_in_use(server.port):
                server.status = 'error'
                server.error = 'Server stopped unexpectedly'
                server.verified_port = False
                self._used_ports.discard(server.port)
            
            return {
                'session_id': server.session_id,
                'port': server.port,
                'url': f'http://localhost:{server.port}' if server.status == 'running' else None,
                'project_dir': server.project_dir,
                'status': server.status,
                'mode': server.mode,
                'project_type': server.project_type,
                'error': server.error,
                'verified_port': server.verified_port
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
