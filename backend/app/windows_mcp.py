"""Small stdio MCP client for the optional Windows-MCP desktop bridge."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from .errors import WorkerError


TOOL_ALLOWLIST = {
    "App", "Snapshot", "Screenshot", "Click", "Type", "Scroll", "Move",
    "Shortcut", "Wait", "WaitFor", "ControlStatus", "DisplayInventory", "PowerShell",
}
READ_ONLY_TOOLS = {"Snapshot", "Screenshot", "Wait", "WaitFor", "ControlStatus", "DisplayInventory"}
# A desktop tool that cannot answer in this time is not useful to the dashboard.
# Keep this bounded so a stuck UIA/MCP call becomes an actionable task failure.
_TOOL_TIMEOUT = int(os.getenv("COMMAND_CENTRE_WINDOWS_MCP_TOOL_TIMEOUT", "35"))
_MCP_STREAM_LIMIT = int(os.getenv("COMMAND_CENTRE_WINDOWS_MCP_STREAM_LIMIT", str(8 * 1024 * 1024)))
logger = logging.getLogger(__name__)


def enabled() -> bool:
    return os.getenv("COMMAND_CENTRE_WINDOWS_MCP_ENABLED", "false").lower() in {"1", "true", "yes", "on"}


def headless_control() -> bool:
    """Disable Windows-MCP's extra ownership dialog/colour overlay when enabled.

    The Command Centre approval boundary remains active in the backend. This only
    disables Windows-MCP's second, desktop-level consent/indicator layer.
    """
    return os.getenv("COMMAND_CENTRE_WINDOWS_MCP_HEADLESS", "false").lower() in {
        "1", "true", "yes", "on"
    }


def tool_prompt_description() -> str:
    return (
        "Windows-MCP executes desktop actions for the Windows desktop worker. "
        "Allowed tool_name values: App (launch/switch/resize apps), Snapshot (inspect accessible UI), "
        "Screenshot (capture desktop), Click, Type, Scroll, Move, Shortcut, Wait, WaitFor, "
        "ControlStatus, DisplayInventory, and PowerShell. Put the upstream tool's arguments in tool_arguments. "
        "For opening an application use App with its launch operation and the app's Start-menu name. "
        "For screen-based tasks inspect with Snapshot, then interact with Click/Type/Shortcut. "
        "Never claim success until a tool result confirms it. One call handles one interaction."
    )


async def invoke(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if not enabled():
        raise WorkerError("Windows-MCP is disabled. Run setup-windows-mcp.ps1 and enable it in .env.")
    if tool_name not in TOOL_ALLOWLIST:
        raise WorkerError("That Windows-MCP tool is not permitted by this project.")

    process = await _start_server()

    try:
        async with asyncio.timeout(_TOOL_TIMEOUT):
            await _rpc(process, 1, "initialize", {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "chill-ai-command-centre", "version": "0.1.0"},
            })
            await _notify(process, "notifications/initialized", {})
            response = await _rpc(process, 2, "tools/call", {"name": tool_name, "arguments": arguments})
            if response.get("isError"):
                details = response.get("content", [])
                message = "; ".join(str(item.get("text", "")) for item in details if isinstance(item, dict))
                raise WorkerError(message or f"Windows-MCP tool {tool_name} returned an error")
            content = response.get("content", [])
            text = "\n".join(str(item.get("text", "")) for item in content if isinstance(item, dict) and item.get("type") == "text")
            images = [item for item in content if isinstance(item, dict) and item.get("type") == "image"]
            return {"tool": tool_name, "result": text[:20000], "image_count": len(images), "structured_content": response.get("structuredContent")}
    except TimeoutError as exc:
        raise WorkerError(f"Windows-MCP did not respond within {_TOOL_TIMEOUT} seconds. Check its setup and try again.") from exc
    except (OSError, asyncio.IncompleteReadError, json.JSONDecodeError, KeyError) as exc:
        raise WorkerError(f"Windows-MCP connection failed: {exc}") from exc
    finally:
        await _stop_server(process)


async def discover_tools() -> list[dict[str, Any]]:
    """Read the installed server's real schemas, filtered through our allowlist."""
    if not enabled():
        return []
    process = await _start_server()
    try:
        async with asyncio.timeout(45):
            await _initialize(process)
            response = await _rpc(process, 2, "tools/list", {})
            return [tool for tool in response.get("tools", []) if tool.get("name") in TOOL_ALLOWLIST]
    except TimeoutError as exc:
        raise WorkerError("Windows-MCP did not return its tool list in time.") from exc
    finally:
        await _stop_server(process)


class WindowsMCPConnection:
    """One MCP stdio session for a multi-step desktop task."""

    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self._request_id = 2
        self.tools: list[dict[str, Any]] = []

    async def start(self) -> list[dict[str, Any]]:
        if not enabled():
            raise WorkerError("Windows-MCP is disabled. Run setup-windows-mcp.ps1 and enable it in .env.")
        self.process = await _start_server()
        try:
            async with asyncio.timeout(45):
                await _initialize(self.process)
                response = await _rpc(self.process, self._request_id, "tools/list", {})
                self._request_id += 1
                self.tools = [item for item in response.get("tools", []) if item.get("name") in TOOL_ALLOWLIST]
                logger.info("Windows-MCP exposed %d permitted tools", len(self.tools))
                return self.tools
        except BaseException:
            await self.close()
            raise

    async def call(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if tool_name not in TOOL_ALLOWLIST or not isinstance(arguments, dict):
            raise WorkerError("The requested Windows-MCP action is not allowed.")
        if self.process is None:
            raise WorkerError("Windows-MCP session is not started.")
        call_started = time.monotonic()
        logger.info("Windows-MCP call started: %s", tool_name)
        async with asyncio.timeout(_TOOL_TIMEOUT):
            response = await _rpc(self.process, self._request_id, "tools/call", {"name": tool_name, "arguments": arguments})
            self._request_id += 1
            if response.get("isError"):
                details = response.get("content", [])
                message = "; ".join(str(item.get("text", "")) for item in details if isinstance(item, dict))
                raise WorkerError(message or f"Windows-MCP tool {tool_name} returned an error")
            content = response.get("content", [])
            text = "\n".join(str(item.get("text", "")) for item in content if isinstance(item, dict) and item.get("type") == "text")
            logger.info("Windows-MCP call finished: %s in %.1fs", tool_name, time.monotonic() - call_started)
            return {"tool": tool_name, "result": text[:20000], "image_count": sum(1 for item in content if isinstance(item, dict) and item.get("type") == "image"), "structured_content": response.get("structuredContent")}

    async def close(self) -> None:
        if self.process is not None:
            await _stop_server(self.process)
            self.process = None


async def _start_server() -> asyncio.subprocess.Process:
    started_at = time.monotonic()
    command = os.getenv("COMMAND_CENTRE_WINDOWS_MCP_COMMAND", "uvx").strip().strip('"\'')
    executable, checked = _find_launcher(command)
    if not executable:
        checked_text = "; ".join(checked[:5])
        raise WorkerError(f"Windows-MCP cannot find uvx.exe. Configured launcher: {command!r}. Checked: {checked_text}. Run setup-windows-mcp.ps1, then restart the Command Centre.")
    allowed_tools = ",".join(sorted(TOOL_ALLOWLIST))
    args = [
        executable, "--python", "3.14", "windows-mcp", "serve",
        "--transport", "stdio", "--tools", allowed_tools,
        "--control-policy", "relaxed",
        "--no-control" if headless_control() else "--control",
    ]
    logger.info("starting Windows-MCP: control=%s timeout=%ss", "disabled" if headless_control() else "enabled", _TOOL_TIMEOUT)
    env = os.environ.copy()
    env["ANONYMIZED_TELEMETRY"] = "false"
    env["WINDOWS_MCP_CONTROL"] = "false" if headless_control() else "true"
    project_root = Path(__file__).resolve().parents[2]
    log_path = project_root / "logs" / "windows-mcp.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with log_path.open("ab") as server_log:
            process = await asyncio.wait_for(
                asyncio.create_subprocess_exec(
                    *args,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=server_log,
                    env=env,
                    limit=_MCP_STREAM_LIMIT,
                ),
                timeout=20,
            )
            logger.info("Windows-MCP process started in %.1fs", time.monotonic() - started_at)
            return process
    except TimeoutError as exc:
        logger.error("Windows-MCP startup timed out after 20s")
        raise WorkerError("Windows-MCP did not start within 20 seconds. Check its install and startup log.") from exc
    except OSError as exc:
        logger.error("Windows-MCP could not start: %s", exc)
        raise WorkerError(f"Could not start Windows-MCP: {exc}") from exc
    except NotImplementedError as exc:
        logger.error("Windows-MCP requires a subprocess-capable event loop")
        raise WorkerError("Windows-MCP needs a Windows subprocess-capable event loop. Restart the backend after this update.") from exc


def _find_launcher(command: str) -> tuple[str | None, list[str]]:
    """Locate uvx in the configured location or standard per-user locations."""
    cleaned_command = command.strip().strip('"\'')
    while "\\\\" in cleaned_command:
        cleaned_command = cleaned_command.replace("\\\\", "\\")
    candidates = [cleaned_command]
    search_roots = {
        Path(os.getenv("APPDATA", "")) / "Python",
        Path(os.getenv("USERPROFILE", "")) / "AppData" / "Roaming" / "Python",
        Path.home() / "AppData" / "Roaming" / "Python",
    }
    for root in search_roots:
        if str(root) not in {"", ".", "Python"} and root.is_dir():
            candidates.extend(str(path) for path in root.glob("Python*/Scripts/uvx.exe"))
    for candidate in candidates:
        cleaned = candidate.strip().strip('"\'')
        if cleaned and (Path(cleaned).is_file() or _launcher_runs(cleaned)):
            return str(Path(cleaned)), candidates
    resolved = shutil.which(command) or shutil.which("uvx.exe") or shutil.which("uvx")
    return resolved, candidates


def _launcher_runs(path: str) -> bool:
    try:
        result = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=5, check=False)
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


async def _initialize(process: asyncio.subprocess.Process) -> None:
    await _rpc(process, 1, "initialize", {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "chill-ai-command-centre", "version": "0.1.0"},
    })
    await _notify(process, "notifications/initialized", {})


async def _stop_server(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=3)
        except TimeoutError:
            process.kill()
            await process.wait()


async def _rpc(process: asyncio.subprocess.Process, request_id: int, method: str, params: dict[str, Any]) -> dict[str, Any]:
    if not process.stdin or not process.stdout:
        raise WorkerError("Windows-MCP did not provide its MCP input/output streams")
    process.stdin.write((json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}) + "\n").encode())
    await process.stdin.drain()
    while True:
        line = await process.stdout.readline()
        if not line:
            raise WorkerError("Windows-MCP closed its connection before returning a result")
        message = json.loads(line.decode("utf-8"))
        if message.get("id") != request_id:
            continue
        if "error" in message:
            error = message["error"]
            raise WorkerError(str(error.get("message", "Windows-MCP request failed")))
        return message.get("result", {})


async def _notify(process: asyncio.subprocess.Process, method: str, params: dict[str, Any]) -> None:
    if not process.stdin:
        raise WorkerError("Windows-MCP did not provide its MCP input stream")
    process.stdin.write((json.dumps({"jsonrpc": "2.0", "method": method, "params": params}) + "\n").encode())
    await process.stdin.drain()
