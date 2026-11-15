"""Project actions plus one configurable Windows desktop execution boundary."""
import asyncio
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .errors import WorkerError


_root_setting = os.getenv("COMMAND_CENTRE_PROJECT_ROOT", r"C:\projects\chill.ai")
if os.name == "nt":
    _root_setting = re.sub(r"^/([A-Za-z])/(.*)$", r"\1:/\2", _root_setting)
ROOT = Path(_root_setting).resolve()
ALLOWED_COMMANDS = {
    "git_status": ["git", "status", "--short"],
    "python_version": ["py", "--version"],
    "node_version": ["node", "--version"],
}

# Docker actions: ps, start, stop, pause, unpause, stats, inspect
_DOCKER_ACTIONS = {
    "list": ["docker", "ps", "--all", "--format", "{{.ID}} {{.Names}} {{.Status}}"],
    "inspect": ["docker", "inspect", "--format", "{{json .State}} {{.Name}}"],
    "pause": ["docker", "pause"],
    "unpause": ["docker", "unpause"],
    "stats": ["docker", "stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}} {{.MemUsage}} {{.NetIO}} {{.BlockIO}}"],
}

_DELETE_WORDS = re.compile(r"\b(delete|remove|erase|wipe|purge|uninstall|format|destroy|clear)\b", re.I)
_MAJOR_SCOPE_WORDS = re.compile(r"\b(all|everything|entire|whole|folder|directory|recursive|recursively|bulk|multiple|permanently|permanent|drive|disk|partition|system)\b", re.I)


class ToolProposal(BaseModel):
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolRequest(BaseModel):
    proposal: ToolProposal


def requires_major_deletion_approval(prompt: str) -> bool:
    """Approval is reserved for broad or irreversible deletion requests."""
    return bool(_DELETE_WORDS.search(prompt.strip()) and _MAJOR_SCOPE_WORDS.search(prompt.strip()))


def requires_approval(proposal: ToolProposal) -> bool:
    if proposal.tool == "move_to_recycle_bin":
        return True
    if proposal.tool == "windows_mcp_task":
        return requires_major_deletion_approval(str(proposal.arguments.get("request", "")))
    return False


def _safe_path(relative: str) -> Path:
    candidate = (ROOT / relative).resolve()
    if candidate != ROOT and ROOT not in candidate.parents:
        raise WorkerError("Path must stay inside the configured project folder")
    return candidate


def catalog() -> list[dict[str, Any]]:
    tools = [
        {"name": "open_windows_path", "approval": False, "description": "Open a Windows folder or existing path using the native shell without screen capture. Arguments: {path: Downloads, Desktop, Documents, or an existing absolute path}. Use for background-safe folder/path opening; do not use Windows-MCP for this."},
        {"name": "read_project_file", "approval": False, "description": "Read a UTF-8 text file under the project root."},
        {"name": "write_project_file", "approval": False, "description": "Create or replace a UTF-8 text file under the project root."},
        {"name": "run_allowlisted_command", "approval": False, "description": "Run git_status, python_version, or node_version."},
        {"name": "docker_compose_action", "approval": False, "description": "Run compose ps, up, or down for this project."},
        {"name": "docker_action", "approval": False, "description": "Run a docker command: list, inspect, pause, unpause, or stats for container management."},
        {"name": "spawn_agent", "approval": False, "description": "Start a registered in-process agent."},
        {"name": "move_to_recycle_bin", "approval": True, "description": "Move a file under the project root to the Windows Recycle Bin."},
    ]
    from .windows_mcp import enabled as windows_mcp_enabled
    from .windows_use_agent import enabled as windows_use_enabled
    if windows_use_enabled() or windows_mcp_enabled():
        tools.append({
            "name": "windows_mcp_task",
            "approval": False,
            "description": "Perform a task on the Windows computer through the configured Windows desktop agent. Arguments: {request: original user request}. The agent inspects the desktop, chooses actions, and verifies the observed result. Use this for every Windows app, desktop, timer, system, or local-machine request.",
        })
    return tools


async def execute(proposal: ToolProposal) -> dict[str, Any]:
    tool, args = proposal.tool, proposal.arguments
    if tool == "open_windows_path":
        requested = str(args.get("path", "")).strip()
        known = {
            "downloads": Path.home() / "Downloads",
            "desktop": Path.home() / "Desktop",
            "documents": Path.home() / "Documents",
        }
        target = known.get(requested.lower(), Path(requested).expanduser())
        if not target.exists():
            raise WorkerError(f"Windows path does not exist: {target}")
        try:
            await asyncio.to_thread(subprocess.Popen, ["explorer.exe", str(target)], cwd=str(target.parent), shell=False)
        except OSError as exc:
            raise WorkerError(f"Could not open Windows path: {exc}") from exc
        return {"opened": True, "path": str(target), "execution": "native_background"}
    if tool == "read_project_file":
        path = _safe_path(str(args.get("path", "")))
        return {"path": str(path), "text": path.read_text(encoding="utf-8")[:20000]}
    if tool == "write_project_file":
        path = _safe_path(str(args.get("path", "")))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(args.get("content", "")), encoding="utf-8")
        return {"path": str(path), "written": True}
    if tool == "run_allowlisted_command":
        name = str(args.get("name", ""))
        if name not in ALLOWED_COMMANDS:
            raise WorkerError("Command is not in the project allowlist")
        return await _run(ALLOWED_COMMANDS[name], 30)
    if tool == "docker_compose_action":
        action = str(args.get("action", ""))
        if action not in {"ps", "up", "down"}:
            raise WorkerError("Docker action must be ps, up, or down")
        command = ["docker", "compose", "ps"] if action == "ps" else ["docker", "compose", action, "-d"] if action == "up" else ["docker", "compose", "down"]
        return await _run(command, 120)
    if tool == "docker_action":
        action = str(args.get("action", ""))
        if action not in _DOCKER_ACTIONS:
            raise WorkerError(f"Unknown docker action. Must be one of: {', '.join(_DOCKER_ACTIONS.keys())}")
        command = _DOCKER_ACTIONS[action]
        return await _run(command, 120)
    if tool == "spawn_agent":
        agent_id = str(args.get("agent_id", ""))
        if agent_id not in {"ollama", "proxy", "hybrid", "demo"}:
            raise WorkerError("Unknown registered agent")
        return {"agent_id": agent_id, "started": True}
    if tool == "move_to_recycle_bin":
        path = _safe_path(str(args.get("path", "")))
        if not path.exists() or path == ROOT:
            raise WorkerError("File does not exist or target is not allowed")
        ps = "$p=\"" + str(path).replace("\"", "``\"") + "\"; Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin')"
        return await _run(["powershell", "-NoProfile", "-Command", ps], 30)
    if tool == "windows_mcp_task":
        request = str(args.get("request", "")).strip()
        if not request:
            raise WorkerError("The Windows desktop task is missing the user's request")
        from .windows_use_agent import enabled as windows_use_enabled, run_windows_use_task
        if windows_use_enabled():
            return await run_windows_use_task(request)
        from .desktop_agent import run_windows_task
        return await run_windows_task(request)
    raise WorkerError("Unknown local tool")


async def _run(command: list[str], timeout: int) -> dict[str, Any]:
    try:
        result = await asyncio.to_thread(subprocess.run, command, cwd=str(ROOT), capture_output=True, text=True, timeout=timeout, shell=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise WorkerError(str(exc)) from exc
    return {"exit_code": result.returncode, "stdout": result.stdout[-10000:], "stderr": result.stderr[-3000:]}
