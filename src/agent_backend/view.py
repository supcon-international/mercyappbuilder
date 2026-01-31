"""View server management for session web projects (build mode only)."""

import asyncio
import logging
import json
import time
import os
import shutil
import signal
import socket
import subprocess
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
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
    package_path: Optional[str] = None
    package_error: Optional[str] = None


class ViewManager:
    """Manages view servers for session projects (build mode only)."""
    
    PORT_START = 4001
    PORT_END = 4100
    
    def __init__(self):
        self._servers: Dict[str, ViewServer] = {}
        self._used_ports: set[int] = set()
        self._package_cache: Dict[str, dict] = {}
        self._force_clean_build: set[str] = set()
        self._lock = asyncio.Lock()
        self._logger = logging.getLogger("appbuilder.view")
    
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

    def _find_uns_file(self, session_dir: str) -> Optional[str]:
        """Find uns.json within the session directory."""
        base_dir = Path(session_dir)
        candidates = [
            base_dir / "app" / "uns.json",
            base_dir / "app" / "UNS.json",
            base_dir / "uns.json",
            base_dir / "UNS.json",
        ]
        for path in candidates:
            if path.exists() and path.is_file():
                return str(path)

        matches: list[tuple[int, Path]] = []
        for path in base_dir.rglob("*.json"):
            if path.is_file() and path.name.lower() == "uns.json":
                rel_depth = len(path.relative_to(base_dir).parts)
                matches.append((rel_depth, path))
        if matches:
            matches.sort(key=lambda item: item[0])
            return str(matches[0][1])

        return None

    def _find_flow_file(
        self,
        session_dir: str,
        project_dir: str,
        dist_dir: Optional[str]
    ) -> Optional[str]:
        """Find flow.json from common build/session locations."""
        candidates = []
        if dist_dir:
            candidates.append(Path(dist_dir) / "flow.json")
        candidates.extend([
            Path(session_dir) / "dist" / "flow.json",
            Path(session_dir) / "build" / "flow.json",
            Path(project_dir) / "flow.json",
            Path(session_dir) / "flow.json",
            Path(session_dir) / "app" / "flow.json",
        ])
        for path in candidates:
            if path.exists() and path.is_file():
                return str(path)
        return None

    def _find_build_output_dir(self, project_dir: str) -> Optional[str]:
        """Find build output directory (dist/build)."""
        for dir_name in ("dist", "build"):
            dir_path = os.path.join(project_dir, dir_name)
            if os.path.exists(dir_path):
                return dir_path
        return None

    def _create_build_package(
        self,
        session_id: str,
        session_dir: str,
        project_dir: str,
        dist_dir: Optional[str]
    ) -> tuple[Optional[str], Optional[str]]:
        """Create a zip package with frontend source, UNS, and flow."""

        artifacts_dir = os.path.join(session_dir, "artifacts")
        os.makedirs(artifacts_dir, exist_ok=True)
        package_path = os.path.join(artifacts_dir, f"{session_id}-build.zip")

        try:
            with zipfile.ZipFile(package_path, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zipf:
                skip_dirs = {
                    "node_modules",
                    ".git",
                    ".vite",
                    "dist",
                    "build",
                    "__pycache__",
                    ".next",
                    ".cache",
                    ".claude",
                    ".agents",
                    ".sessions",
                    "artifacts",
                    "logs",
                }
                for root, dirs, files in os.walk(project_dir):
                    dirs[:] = [
                        d for d in dirs
                        if d not in skip_dirs and not d.startswith(".")
                    ]
                    for file in files:
                        if file.startswith("."):
                            continue
                        file_path = os.path.join(root, file)
                        rel_path = os.path.relpath(file_path, project_dir)
                        zipf.write(file_path, os.path.join("frontend", rel_path))

                uns_path = self._find_uns_file(session_dir)
                if uns_path:
                    zipf.write(uns_path, "uns.json")

                flow_path = self._find_flow_file(session_dir, project_dir, dist_dir)
                if flow_path:
                    zipf.write(flow_path, "flow.json")
        except Exception as e:
            return None, f"Failed to create package: {e}"

        return package_path, None

    def _cache_package(
        self,
        session_id: str,
        project_dir: str,
        package_path: Optional[str],
        package_error: Optional[str]
    ) -> None:
        self._package_cache[session_id] = {
            "project_dir": project_dir,
            "package_path": package_path,
            "package_error": package_error,
        }
    
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
                if server.status in ('building', 'running'):
                    if server.status == 'building':
                        self._logger.info("Build already in progress for %s, reusing current build", session_id)
                        return server
                    if server.process and server.process.poll() is None:
                        if self._is_port_in_use(server.port):
                            self._logger.info("Reusing existing server for %s on port %s", session_id, server.port)
                            return server
                # Clean up old state
                await self._stop_server(session_id)
                del self._servers[session_id]
            
            # Find project directory
            project_dir, candidates = self._find_project_dir(working_directory)
            
            if not project_dir:
                error_msg = f'No package.json found. Searched in: {working_directory}'
                self._logger.error("View start failed: %s", error_msg)
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
            
            force_clean_build = session_id in self._force_clean_build
            if force_clean_build:
                self._force_clean_build.discard(session_id)

            # Allocate port
            port = self._find_available_port()
            self._used_ports.add(port)
            
            server = ViewServer(
                session_id=session_id,
                port=port,
                process=None,
                project_dir=project_dir,
                status='building',
                candidates_found=candidates
            )
            self._servers[session_id] = server
        
        # Build in background to keep API responsive
        async def run_build():
            try:
                await self._build_and_serve(server, working_directory, project_dir, force_clean_build)
            except Exception as e:
                self._logger.error("Background build error for %s: %s", server.session_id, e)
                server.status = 'error'
                server.error = str(e)
                self._used_ports.discard(server.port)
        
        asyncio.create_task(run_build())
        return server
    
    async def _import_session_flow(
        self,
        session_id: str,
        session_dir: str,
        project_dir: str,
        dist_dir: Optional[str]
    ) -> None:
        """Import flow.json into Node-RED if it exists."""
        flow_json_path = self._find_flow_file(session_dir, project_dir, dist_dir)
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
    
    async def _build_and_serve(
        self,
        server: ViewServer,
        session_dir: str,
        project_dir: str,
        force_clean_build: bool,
    ) -> None:
        """Build project and start a static server."""
        try:
            # Check if node_modules exists, if not run npm install first
            node_modules = os.path.join(project_dir, "node_modules")
            if not os.path.exists(node_modules):
                self._logger.info("Installing dependencies for %s", server.session_id)
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
                        self._logger.error("Install failed for %s: %s", server.session_id, error_msg)
                        server.status = 'error'
                        server.error = error_msg
                        self._used_ports.discard(server.port)
                        return
                except asyncio.TimeoutError:
                    error_msg = 'npm install timed out (180s)'
                    self._logger.error("Install timed out for %s", server.session_id)
                    server.status = 'error'
                    server.error = error_msg
                    self._used_ports.discard(server.port)
                    return
                except Exception as e:
                    error_msg = f'Failed to install dependencies: {str(e)}'
                    self._logger.error("Install failed for %s: %s", server.session_id, error_msg)
                    server.status = 'error'
                    server.error = error_msg
                    self._used_ports.discard(server.port)
                    return
            
            dist_dir = None
            # Preserve flow/UNS artifacts across builds (vite may wipe dist/)
            prebuild_flow_content: str | None = None
            prebuild_flow_path: str | None = None
            prebuild_uns_content: str | None = None
            prebuild_uns_name: str | None = None

            prebuild_flow_candidates = [
                os.path.join(project_dir, "dist", "flow.json"),
                os.path.join(project_dir, "build", "flow.json"),
                os.path.join(project_dir, "flow.json"),
                os.path.join(session_dir, "flow.json"),
                os.path.join(session_dir, "app", "flow.json"),
            ]
            for candidate in prebuild_flow_candidates:
                if os.path.exists(candidate) and os.path.isfile(candidate):
                    try:
                        prebuild_flow_content = Path(candidate).read_text(encoding="utf-8")
                        prebuild_flow_path = candidate
                        break
                    except Exception:
                        pass

            prebuild_uns_path = self._find_uns_file(session_dir)
            if prebuild_uns_path and os.path.exists(prebuild_uns_path):
                try:
                    prebuild_uns_content = Path(prebuild_uns_path).read_text(encoding="utf-8")
                    prebuild_uns_name = os.path.basename(prebuild_uns_path)
                except Exception:
                    prebuild_uns_content = None
                    prebuild_uns_name = None

            # Check if we have a build script
            if self._has_build_script(project_dir):
                if force_clean_build:
                    for dir_name in ["dist", "build"]:
                        dir_path = os.path.join(project_dir, dir_name)
                        if os.path.exists(dir_path):
                            try:
                                shutil.rmtree(dir_path)
                            except Exception as e:
                                self._logger.warning("Failed to clean %s for %s: %s", dir_path, server.session_id, e)

                max_retries = 3
                last_error = ""
                build_started = time.perf_counter()
                
                for attempt in range(max_retries):
                    # Clean dist directory before retry
                    if attempt > 0:
                        self._logger.warning("Retry %s/%s for %s", attempt + 1, max_retries, server.session_id)
                        for dir_name in ["dist", "build"]:
                            dir_path = os.path.join(project_dir, dir_name)
                            if os.path.exists(dir_path):
                                try:
                                    shutil.rmtree(dir_path)
                                except Exception as e:
                                    print(f"[VIEW] Failed to clean {dir_path}: {e}")
                        await asyncio.sleep(1)
                    
                    self._logger.info(
                        "Building project for %s%s",
                        server.session_id,
                        f" (attempt {attempt + 1})" if attempt > 0 else ""
                    )
                    
                    build_process = await asyncio.create_subprocess_exec(
                        "npm", "run", "build", "--", "--base=./",
                        cwd=project_dir,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    
                    try:
                        stdout, stderr = await asyncio.wait_for(build_process.communicate(), timeout=180)
                        
                        if build_process.returncode == 0:
                            build_elapsed = time.perf_counter() - build_started
                            self._logger.info("Build succeeded for %s", server.session_id)
                            self._logger.info("Build duration for %s: %.2fs", server.session_id, build_elapsed)
                            break
                        else:
                            build_elapsed = time.perf_counter() - build_started
                            last_error = stderr.decode()[:500]
                            self._logger.error(
                                "Build failed (attempt %s) for %s: %s",
                                attempt + 1,
                                server.session_id,
                                last_error[:100]
                            )
                            self._logger.error("Build duration for %s: %.2fs", server.session_id, build_elapsed)
                            if attempt == max_retries - 1:
                                server.status = 'error'
                                server.error = f'Build failed after {max_retries} attempts: {last_error}'
                                self._used_ports.discard(server.port)
                                return
                    except asyncio.TimeoutError:
                        build_elapsed = time.perf_counter() - build_started
                        last_error = 'Build timed out (180s)'
                        self._logger.error("Build timed out for %s", server.session_id)
                        self._logger.error("Build duration for %s: %.2fs", server.session_id, build_elapsed)
                        if attempt == max_retries - 1:
                            server.status = 'error'
                            server.error = last_error
                            self._used_ports.discard(server.port)
                            return
                
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
                        self._used_ports.discard(server.port)
                        return
                
                # Restore flow/UNS artifacts if they were present before build
                if dist_dir and os.path.exists(dist_dir):
                    try:
                        if prebuild_flow_content:
                            (Path(dist_dir) / "flow.json").write_text(prebuild_flow_content, encoding="utf-8")
                        else:
                            flow_src = prebuild_flow_path or self._find_flow_file(session_dir, project_dir, None)
                            if flow_src and os.path.exists(flow_src):
                                shutil.copy2(flow_src, os.path.join(dist_dir, "flow.json"))
                    except Exception as e:
                        self._logger.warning("Failed to restore flow.json for %s: %s", server.session_id, e)

                    try:
                        if prebuild_uns_content and prebuild_uns_name:
                            (Path(dist_dir) / prebuild_uns_name).write_text(prebuild_uns_content, encoding="utf-8")
                        else:
                            uns_src = self._find_uns_file(session_dir)
                            if uns_src and os.path.exists(uns_src):
                                shutil.copy2(uns_src, os.path.join(dist_dir, os.path.basename(uns_src)))
                    except Exception as e:
                        self._logger.warning("Failed to restore UNS.json for %s: %s", server.session_id, e)

                await self._import_session_flow(server.session_id, session_dir, project_dir, dist_dir)

                serve_dir = dist_dir
            else:
                # No build script, serve the project directory directly (static site)
                self._logger.info("No build script, serving directory directly: %s", project_dir)
                serve_dir = project_dir

            # Start static server using npx serve
            self._logger.info("Starting static server for %s on port %s", server.session_id, server.port)
            process = subprocess.Popen(
                ["npx", "serve", "-s", serve_dir, "-l", str(server.port), "--cors", "--no-clipboard"],
                cwd=project_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                preexec_fn=os.setsid
            )
            
            server.process = process
            
            # Wait for server to start
            port_ready = await self._verify_port_listening(server.port, timeout=15.0)
            
            if process.poll() is None and port_ready:
                server.status = 'running'
                self._logger.info("Server started for %s on port %s", server.session_id, server.port)
            else:
                stderr_output = ""
                if process.poll() is not None:
                    try:
                        stderr_output = process.stderr.read().decode()[:200]
                    except:
                        pass
                server.status = 'error'
                server.error = f'Static server failed to start. {stderr_output}'
                self._used_ports.discard(server.port)
                self._logger.error("Server failed to start for %s: %s", server.session_id, server.error)
            
            # Create build package in background (non-blocking)
            async def create_package():
                try:
                    package_path, package_error = await asyncio.to_thread(
                        self._create_build_package,
                        server.session_id,
                        session_dir,
                        project_dir,
                        dist_dir if self._has_build_script(project_dir) else None
                    )
                    if package_error:
                        self._logger.error("Package creation failed for %s: %s", server.session_id, package_error)
                    server.package_path = package_path
                    server.package_error = package_error
                    async with self._lock:
                        self._cache_package(server.session_id, project_dir, package_path, package_error)
                except Exception as e:
                    server.package_error = f"Failed to create package: {e}"
                    self._logger.error("Package creation failed for %s: %s", server.session_id, e)

            asyncio.create_task(create_package())
            
        except Exception as e:
            self._used_ports.discard(server.port)
            server.status = 'error'
            server.error = str(e)
            self._logger.error("View build exception for %s: %s", server.session_id, e)
            return
    
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
            self._force_clean_build.add(session_id)
            return result
    
    async def get_status(self, session_id: str) -> Optional[dict]:
        """Get the status of a view server."""
        async with self._lock:
            if session_id not in self._servers:
                cached = self._package_cache.get(session_id)
                if cached and cached.get("package_path"):
                    return {
                        'session_id': session_id,
                        'port': None,
                        'url': None,
                        'project_dir': cached.get("project_dir"),
                        'status': 'not_started',
                        'error': None,
                        'candidates_found': [],
                        'package_ready': True,
                        'package_error': cached.get("package_error"),
                    }
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
            
            # Recover from stale "building" state if port is live
            if server.status == 'building' and self._is_port_in_use(server.port):
                server.status = 'running'
            
            return {
                'session_id': server.session_id,
                'port': server.port,
                'url': f'http://localhost:{server.port}' if server.status == 'running' else None,
                'project_dir': server.project_dir,
                'status': server.status,
                'error': server.error,
                'candidates_found': server.candidates_found,
                'package_ready': bool(server.package_path and os.path.exists(server.package_path)),
                'package_error': server.package_error
            }

    async def prepare_artifacts(self, session_id: str, session_dir: str) -> tuple[Optional[str], Optional[str]]:
        """Create a build package and cache it for download."""
        project_dir, _ = self._find_project_dir(session_dir)
        if not project_dir:
            return None, "No project directory found"

        dist_dir = self._find_build_output_dir(project_dir)
        package_path, package_error = await asyncio.to_thread(
            self._create_build_package,
            session_id,
            session_dir,
            project_dir,
            dist_dir
        )
        async with self._lock:
            self._cache_package(session_id, project_dir, package_path, package_error)
        return package_path, package_error

    async def get_or_create_package(self, session_id: str, session_dir: str) -> Optional[str]:
        """Get existing package path or create one if build output exists."""
        async with self._lock:
            server = self._servers.get(session_id)
            if server and server.package_path and os.path.exists(server.package_path):
                return server.package_path

        project_dir, _ = self._find_project_dir(session_dir)
        if not project_dir:
            return None
        dist_dir = self._find_build_output_dir(project_dir)
        package_path, package_error = self._create_build_package(
            session_id,
            session_dir,
            project_dir,
            dist_dir
        )

        async with self._lock:
            server = self._servers.get(session_id)
            if server:
                server.package_path = package_path
                server.package_error = package_error
            self._cache_package(session_id, project_dir, package_path, package_error)

        return package_path
    
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
