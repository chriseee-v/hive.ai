"""A bounded, model-guided worker for approved Windows-MCP tasks."""
import asyncio
import json
import os
import logging
import re
import time
from typing import Any

from .errors import WorkerError
from .orchestrator import OllamaClient, ProxyClient
from .windows_mcp import WindowsMCPConnection


_MAX_STEPS = int(os.getenv("COMMAND_CENTRE_WINDOWS_MCP_MAX_STEPS", "10"))
_TASK_TIMEOUT = int(os.getenv("COMMAND_CENTRE_WINDOWS_MCP_TASK_TIMEOUT", "90"))
logger = logging.getLogger(__name__)


def _decode_json(raw: str) -> dict[str, Any]:
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise WorkerError("The local desktop model did not return a usable action plan.")
    try:
        value = json.loads(raw[start : end + 1])
    except json.JSONDecodeError as exc:
        raise WorkerError("The local desktop model returned invalid action JSON.") from exc
    if not isinstance(value, dict):
        raise WorkerError("The local desktop model returned an invalid action plan.")
    return value


def _observation(result: dict[str, Any]) -> str:
    parts = [str(result.get("result", ""))]
    if result.get("structured_content") is not None:
        parts.append(json.dumps(result["structured_content"], ensure_ascii=False, default=str))
    return "\n".join(part for part in parts if part)[:18000]


def _usable_action(plan: dict[str, Any], allowed: set[str]) -> bool:
    return (
        plan.get("done") is True
        or (plan.get("tool_name") in allowed and isinstance(plan.get("arguments"), dict))
    )


def _requested_app(request: str) -> str | None:
    match = re.search(r"\bopen\s+(?:the\s+)?(.+?)\s+app\b", request.lower())
    return " ".join(match.group(1).split()) if match else None


def _matches_requested_app(plan: dict[str, Any], request: str, step: int) -> bool:
    """Prevent a generic desktop model from launching an unrelated application."""
    target = _requested_app(request)
    if not target or step != 0:
        return True
    arguments = plan.get("arguments") or {}
    name = str(arguments.get("name", "")).lower()
    return plan.get("tool_name") == "App" and arguments.get("mode", "launch") == "launch" and target in name


async def run_windows_task(request: str) -> dict[str, Any]:
    """Use only the live Windows-MCP tools to complete one approved desktop task."""
    started_at = time.monotonic()
    logger.info("desktop task started: %s", request[:120])
    try:
        async with asyncio.timeout(_TASK_TIMEOUT):
            result = await _run_windows_task_bounded(request)
            logger.info("desktop task completed in %.1fs", time.monotonic() - started_at)
            return result
    except TimeoutError as exc:
        logger.error("desktop task timed out after %ss", _TASK_TIMEOUT)
        raise WorkerError(
            f"Windows-MCP stopped after {_TASK_TIMEOUT} seconds without confirming a desktop result. "
            "Check that the Windows desktop is unlocked and the MCP server can see the active display."
        ) from exc


async def _run_windows_task_bounded(request: str) -> dict[str, Any]:
    mcp = WindowsMCPConnection()
    model = OllamaClient()
    transcript: list[str] = []
    try:
        logger.info("connecting to Windows-MCP and reading live tool schemas")
        tools = await mcp.start()
        allowed = {str(tool.get("name")) for tool in tools}
        if not tools:
            raise WorkerError("Windows-MCP started but did not expose any allowed tools.")
        logger.info("Windows-MCP ready with %d allowed tools", len(tools))
        # Avoid requesting an image on the first call. This keeps the initial
        # observation small while still returning the current window summary.
        # Detailed UI extraction is requested only after an action needs it.
        logger.info("requesting initial text-only desktop snapshot")
        initial = await mcp.call("Snapshot", {"use_vision": False, "use_ui_tree": False})
        logger.info("initial text-only desktop snapshot received")
        observation = _observation(initial)
        schemas = json.dumps(tools, ensure_ascii=False, default=str)
        system = f"""You are the local Windows desktop agent. Complete the user's approved request using only the live Windows-MCP tools listed below. Work from the observed desktop rather than guessing. Return exactly one JSON object each turn.

For the next operation return {{"done":false,"tool_name":"exact live tool name","arguments":{{...}},"note":"what this step checks or changes"}}.
Only when the latest MCP observation proves the request completed, return {{"done":true,"summary":"what the desktop now shows"}}.
Never switch to a scheduler, reminder substitute, direct subprocess, or any non-MCP route. Use the initial screenshot/window summary to choose the first action. Use Snapshot before targeting UI controls, then take another Snapshot after a changing operation. Use exact schema-compatible arguments only. Do not claim success based only on a requested click. If a task cannot be completed from visible UI, finish with done=true and a truthful summary explaining the observed blocker.

Live Windows-MCP tool schemas:
{schemas}"""

        for step in range(_MAX_STEPS):
            logger.info("desktop step %d/%d: asking local model for next action", step + 1, _MAX_STEPS)
            context = json.dumps({
                "user_request": request,
                "latest_desktop_observation": observation,
                "previous_mcp_results": transcript[-8:],
                "remaining_steps": _MAX_STEPS - step,
            }, ensure_ascii=False)
            messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": context},
            ]
            try:
                plan = _decode_json(await model.chat(messages, num_predict=260))
            except WorkerError:
                retry = context + "\nReturn only compact JSON. Do not include markdown, explanations, or a second object."
                plan = _decode_json(await model.chat([
                    {"role": "system", "content": system},
                    {"role": "user", "content": retry},
                ], num_predict=180))
            logger.info("local desktop plan: %s", json.dumps(plan, ensure_ascii=False, default=str)[:500])
            if not _usable_action(plan, allowed) or not _matches_requested_app(plan, request, step):
                # Qwen remains the default local planner. Luna is used only as
                # a recovery planner when Qwen cannot name a live MCP tool.
                # The action still executes locally and never receives a shell.
                try:
                    logger.warning("local desktop plan was unusable; asking CLIProxyAPI/Luna for a recovery plan")
                    cloud_prompt = (
                        system
                        + "\nThe local planner failed. Return one compact JSON object only. "
                        + "Choose an exact live tool and valid schema arguments; do not explain.\n"
                        + context
                    )
                    cloud_raw = await asyncio.wait_for(ProxyClient().responses(cloud_prompt), timeout=30)
                    cloud_plan = _decode_json(cloud_raw)
                    logger.info("cloud recovery plan: %s", json.dumps(cloud_plan, ensure_ascii=False, default=str)[:500])
                    if _usable_action(cloud_plan, allowed) and _matches_requested_app(cloud_plan, request, step):
                        plan = cloud_plan
                    else:
                        logger.warning("cloud recovery plan was also unusable")
                except (TimeoutError, WorkerError, ValueError, TypeError) as exc:
                    logger.warning("cloud recovery planning unavailable: %s", exc)
            if plan.get("done") is True:
                summary = str(plan.get("summary", "The desktop task completed.")).strip()
                logger.info("desktop model confirmed completion at step %d", step + 1)
                return {"completed": True, "summary": summary[:1000], "steps": transcript}
            tool_name = plan.get("tool_name")
            arguments = plan.get("arguments")
            if tool_name not in allowed or not isinstance(arguments, dict):
                logger.warning("desktop model produced invalid tool action: %s", tool_name)
                transcript.append("Rejected an invalid model action; select a live MCP tool and JSON arguments.")
                continue
            if tool_name == "Wait":
                try:
                    seconds = int(arguments.get("duration", 0))
                except (TypeError, ValueError):
                    seconds = 0
                if not 1 <= seconds <= 8:
                    transcript.append("Rejected Wait: duration must be between 1 and 8 seconds.")
                    continue
            try:
                logger.info("desktop step %d: calling Windows-MCP tool %s", step + 1, tool_name)
                result = await mcp.call(tool_name, arguments)
                result_text = _observation(result)
                transcript.append(f"{tool_name}: {result_text[:2400]}")
                if tool_name == "Snapshot":
                    observation = result_text
                else:
                    observed = await mcp.call("Snapshot", {"use_vision": False, "use_ui_tree": True})
                    observation = _observation(observed)
                    transcript.append(f"Snapshot: {observation[:2400]}")
                logger.info("desktop step %d: %s completed and desktop re-snapshotted", step + 1, tool_name)
            except WorkerError as exc:
                transcript.append(f"{tool_name} failed: {exc}")
                logger.warning("desktop step %d: %s failed: %s", step + 1, tool_name, exc)

        raise WorkerError(
            f"Windows-MCP reached its {_MAX_STEPS}-step limit before it could verify completion. "
            "The local desktop model did not produce a confirmed final state."
        )
    finally:
        await mcp.close()
