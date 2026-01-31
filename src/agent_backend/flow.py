"""Node-RED flow server management (shared across sessions)."""

import asyncio
import json
import os
import shutil
import signal
import socket
import subprocess
from dataclasses import dataclass
from typing import Any, Optional

import httpx
import logging


@dataclass
class FlowServer:
    """Represents the shared Node-RED server."""
    port: int
    process: Optional[subprocess.Popen]
    status: str  # 'not_started', 'starting', 'running', 'stopped', 'error'
    error: Optional[str] = None
    managed: bool = True  # True if started by this app


class FlowManager:
    """Manages a shared Node-RED instance for all sessions."""

    PORT = 1880

    def __init__(self):
        self._server: Optional[FlowServer] = None
        self._lock = asyncio.Lock()
        self._logger = logging.getLogger("appbuilder.flow")

    def _is_port_in_use(self, port: int) -> bool:
        """Check if a port is currently in use."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                result = s.connect_ex(("127.0.0.1", port))
                return result == 0
        except Exception:
            return False

    def _get_project_root(self) -> str:
        return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

    def _get_user_dir(self) -> str:
        return os.path.join(self._get_project_root(), ".nodered")

    def _ensure_settings(self, user_dir: str) -> None:
        """Create a minimal settings.js that serves the editor under /flow."""
        settings_path = os.path.join(user_dir, "settings.js")
        if os.path.exists(settings_path):
            return
        settings_content = """module.exports = {
  uiPort: process.env.PORT || 1880,
  httpAdminRoot: "/flow",
  httpNodeRoot: "/flow/api"
};
"""
        with open(settings_path, "w", encoding="utf-8") as f:
            f.write(settings_content)

    def _get_command(self) -> Optional[list[str]]:
        # Prefer local installation in project directory
        local_bin = os.path.join(self._get_project_root(), "node_modules", ".bin", "node-red")
        if os.path.exists(local_bin):
            return [local_bin]
        if shutil.which("node-red"):
            return ["node-red"]
        if shutil.which("npx"):
            return ["npx", "node-red"]
        return None

    async def _verify_port_listening(self, port: int, timeout: float = 10.0) -> bool:
        """Wait for a port to start listening."""
        start_time = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - start_time < timeout:
            if self._is_port_in_use(port):
                return True
            await asyncio.sleep(0.5)
        return False

    async def start_flow(self) -> FlowServer:
        """Start (or reuse) the shared Node-RED server."""
        async with self._lock:
            if self._server and self._server.status == "running":
                if self._server.managed:
                    if self._server.process and self._server.process.poll() is None and self._is_port_in_use(self._server.port):
                        return self._server
                else:
                    if self._is_port_in_use(self._server.port):
                        return self._server

            if self._is_port_in_use(self.PORT) and (self._server is None or not self._server.managed):
                self._logger.info("Using existing Node-RED on port %s", self.PORT)
                self._server = FlowServer(port=self.PORT, process=None, status="running", managed=False)
                return self._server

            command = self._get_command()
            if not command:
                self._logger.error("Node-RED not available on PATH")
                self._server = FlowServer(
                    port=self.PORT,
                    process=None,
                    status="error",
                    error="node-red (or npx) is not available on PATH",
                    managed=True,
                )
                return self._server

            user_dir = self._get_user_dir()
            os.makedirs(user_dir, exist_ok=True)
            self._ensure_settings(user_dir)

            try:
                self._logger.info("Starting Node-RED on port %s", self.PORT)
                process = subprocess.Popen(
                    [*command, "-p", str(self.PORT), "-u", user_dir],
                    cwd=user_dir,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    preexec_fn=os.setsid,
                )
            except Exception as e:
                self._logger.error("Failed to start Node-RED: %s", e)
                self._server = FlowServer(
                    port=self.PORT,
                    process=None,
                    status="error",
                    error=f"Failed to start Node-RED: {e}",
                    managed=True,
                )
                return self._server

            server = FlowServer(port=self.PORT, process=process, status="starting", managed=True)
            self._server = server

            port_ready = await self._verify_port_listening(self.PORT, timeout=15.0)
            if process.poll() is None and port_ready:
                server.status = "running"
                self._logger.info("Node-RED started on port %s", self.PORT)
            else:
                server.status = "error"
                server.error = "Node-RED failed to start"
                self._logger.error("Node-RED failed to start on port %s", self.PORT)
            return server

    async def stop_flow(self) -> bool:
        """Stop the shared Node-RED server if managed by this app."""
        async with self._lock:
            if not self._server:
                return False
            server = self._server
            if server.managed and server.process and server.process.poll() is None:
                try:
                    os.killpg(os.getpgid(server.process.pid), signal.SIGTERM)
                    await asyncio.sleep(0.5)
                    if server.process.poll() is None:
                        os.killpg(os.getpgid(server.process.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except Exception as e:
                    self._logger.error("Error stopping Node-RED: %s", e)
            server.status = "stopped"
            server.process = None
            return True

    async def get_status(self) -> Optional[dict]:
        """Get the current status of the shared flow server."""
        async with self._lock:
            if self._server:
                server = self._server
                if server.managed and server.process and server.process.poll() is not None:
                    server.status = "stopped"
            elif self._is_port_in_use(self.PORT):
                self._server = FlowServer(port=self.PORT, process=None, status="running", managed=False)
            else:
                return None

            return {
                "status": self._server.status,
                "port": self._server.port,
                "error": self._server.error,
                "managed": self._server.managed,
            }

    async def import_flow_from_file(self, session_id: str, flow_json_path: str) -> dict[str, Any]:
        """
        Import a flow from a JSON file into Node-RED.
        
        The flow.json should have structure:
        {
            "id": "session_id",
            "label": "Flow Name",
            "nodes": [...]
        }
        
        Returns dict with 'success', 'message', and optionally 'flow_id'.
        """
        if not os.path.exists(flow_json_path):
            return {"success": False, "message": f"Flow file not found: {flow_json_path}"}
        
        try:
            with open(flow_json_path, "r", encoding="utf-8") as f:
                flow_data = json.load(f)
        except json.JSONDecodeError as e:
            return {"success": False, "message": f"Invalid JSON in flow file: {e}"}
        except Exception as e:
            return {"success": False, "message": f"Failed to read flow file: {e}"}
        
        # Ensure Node-RED is running
        server = await self.start_flow()
        if server.status != "running":
            return {"success": False, "message": server.error or "Node-RED not running"}
        
        # Convert flow.json to Node-RED format
        # Node-RED expects: [tab_node, ...child_nodes]
        nodered_nodes: list[dict[str, Any]] = []
        flow_id = session_id
        flow_label = f"Session {session_id[:8]}"
        
        if isinstance(flow_data, list):
            # Assume Node-RED export format (list of nodes)
            nodered_nodes = [n for n in flow_data if isinstance(n, dict)]
            tab_nodes = [n for n in nodered_nodes if n.get("type") == "tab"]
            if tab_nodes:
                flow_id = tab_nodes[0].get("id") or flow_id
                flow_label = tab_nodes[0].get("label") or flow_label
            else:
                # Wrap in a new tab if missing
                tab_node = {
                    "id": flow_id,
                    "type": "tab",
                    "label": flow_label,
                    "disabled": False,
                    "info": f"Auto-imported from session {session_id}",
                }
                nodered_nodes = [tab_node] + [
                    {**node, "z": node.get("z", flow_id)} for node in nodered_nodes
                ]
        elif isinstance(flow_data, dict):
            flow_id = flow_data.get("id", flow_id)
            flow_label = flow_data.get("label", flow_label)
            nodes = flow_data.get("nodes", [])
            tab_node = {
                "id": flow_id,
                "type": "tab",
                "label": flow_label,
                "disabled": False,
                "info": f"Auto-imported from session {session_id}",
            }
            nodered_nodes = [tab_node] + [
                {**node, "z": node.get("z", flow_id)} for node in nodes if isinstance(node, dict)
            ]
        else:
            return {"success": False, "message": "Unsupported flow.json format"}
        
        # Use Node-RED Admin API to import the flow
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # First, get existing flows
                get_resp = await client.get(f"http://localhost:{self.PORT}/flow/flows")
                if get_resp.status_code != 200:
                    return {"success": False, "message": f"Failed to get existing flows: {get_resp.status_code}"}
                
                existing_flows = get_resp.json()
                
                # Remove any existing flow with the same ID
                filtered_flows = [
                    f for f in existing_flows
                    if isinstance(f, dict) and f.get("id") != flow_id and f.get("z") != flow_id
                ]
                
                # Add the new flow nodes
                updated_flows = filtered_flows + nodered_nodes
                
                # Deploy the updated flows
                deploy_resp = await client.post(
                    f"http://localhost:{self.PORT}/flow/flows",
                    json=updated_flows,
                    headers={"Content-Type": "application/json", "Node-RED-Deployment-Type": "flows"},
                )
                
                if deploy_resp.status_code in (200, 204):
                    self._logger.info("Imported flow %s (%s nodes)", flow_id, len(nodered_nodes))
                    return {
                        "success": True,
                        "message": f"Flow '{flow_label}' imported successfully",
                        "flow_id": flow_id,
                    }
                else:
                    self._logger.error("Flow deploy failed: %s %s", deploy_resp.status_code, deploy_resp.text)
                    return {
                        "success": False,
                        "message": f"Failed to deploy flow: {deploy_resp.status_code} - {deploy_resp.text}",
                    }
        except httpx.ConnectError:
            self._logger.error("Cannot connect to Node-RED for flow import")
            return {"success": False, "message": "Cannot connect to Node-RED"}
        except Exception as e:
            self._logger.error("Error importing flow: %s", e)
            return {"success": False, "message": f"Error importing flow: {e}"}

    async def check_flow_exists(self, flow_id: str) -> bool:
        """Check if a flow with the given ID exists in Node-RED."""
        if not self._is_port_in_use(self.PORT):
            return False
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"http://localhost:{self.PORT}/flow/flow/{flow_id}")
                return resp.status_code == 200
        except Exception:
            return False

    async def delete_flow(self, flow_id: str) -> dict[str, Any]:
        """
        Delete a flow from Node-RED by its ID.
        
        Returns dict with 'success' and 'message'.
        """
        if not self._is_port_in_use(self.PORT):
            return {"success": False, "message": "Node-RED not running"}
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Get existing flows
                get_resp = await client.get(f"http://localhost:{self.PORT}/flow/flows")
                if get_resp.status_code != 200:
                    return {"success": False, "message": f"Failed to get flows: {get_resp.status_code}"}
                
                existing_flows = get_resp.json()
                
                # Filter out the flow tab and all nodes belonging to it
                filtered_flows = [
                    f for f in existing_flows 
                    if f.get("id") != flow_id and f.get("z") != flow_id
                ]
                
                # Check if anything was removed
                if len(filtered_flows) == len(existing_flows):
                    return {"success": True, "message": f"Flow {flow_id} not found (nothing to delete)"}
                
                # Deploy the updated flows
                deploy_resp = await client.post(
                    f"http://localhost:{self.PORT}/flow/flows",
                    json=filtered_flows,
                    headers={"Content-Type": "application/json", "Node-RED-Deployment-Type": "flows"},
                )
                
                if deploy_resp.status_code in (200, 204):
                    removed_count = len(existing_flows) - len(filtered_flows)
                    return {
                        "success": True,
                        "message": f"Flow {flow_id} deleted ({removed_count} nodes removed)",
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Failed to deploy: {deploy_resp.status_code}",
                    }
        except httpx.ConnectError:
            return {"success": False, "message": "Cannot connect to Node-RED"}
        except Exception as e:
            return {"success": False, "message": f"Error deleting flow: {e}"}


# Global flow manager instance
flow_manager: Optional[FlowManager] = None


def get_flow_manager() -> FlowManager:
    """Get or create the flow manager instance."""
    global flow_manager
    if flow_manager is None:
        flow_manager = FlowManager()
    return flow_manager
