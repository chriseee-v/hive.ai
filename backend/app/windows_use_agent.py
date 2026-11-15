"""Windows-Use adapter for approved Command Centre desktop tasks."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from .errors import WorkerError

logger = logging.getLogger(__name__)


def _provider_value(*names: str) -> str:
    """Read provider settings loaded from this project's .env only."""
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


def enabled() -> bool:
    return os.getenv("COMMAND_CENTRE_WINDOWS_USE_ENABLED", "true").lower() in {
        "1", "true", "yes", "on"
    }


def _provider(provider_override: str | None = None) -> Any:
    provider = (provider_override or os.getenv("COMMAND_CENTRE_WINDOWS_USE_PROVIDER", "proxy")).lower()
    if provider == "ollama":
        from windows_use.providers.ollama import ChatOllama

        return ChatOllama(
            model=os.getenv("COMMAND_CENTRE_OLLAMA_MODEL", "qwen3.5:4b"),
            host=os.getenv("COMMAND_CENTRE_OLLAMA_URL", "http://127.0.0.1:11434"),
            timeout=float(os.getenv("COMMAND_CENTRE_WINDOWS_USE_LLM_TIMEOUT", "45")),
            temperature=0.1,
            think=False,
        )

    from windows_use.providers.openai import ChatOpenAI

    if provider in {"openrouter", "cerebras"}:
        prefix = provider.upper()
        api_key_names = [f"COMMAND_CENTRE_{prefix}_API_KEY", f"{prefix}_API_KEY"]
        if provider == "openrouter":
            api_key_names.append("OPEN_ROUTER_API_KEY")
        api_key = _provider_value(*api_key_names)
        base_url = os.getenv(
            f"COMMAND_CENTRE_{prefix}_BASE_URL",
            "https://openrouter.ai/api/v1" if provider == "openrouter" else "https://api.cerebras.ai/v1",
        )
        model = os.getenv(
            "COMMAND_CENTRE_WINDOWS_USE_MODEL"
            if provider == "openrouter"
            else "COMMAND_CENTRE_CEREBRAS_MODEL",
            "qwen-3-235b-a22b-instruct-2507" if provider == "cerebras" else "openai/gpt-oss-120b:free",
        )
        if not api_key:
            raise WorkerError(f"{provider.title()} is selected for Windows-Use but its API key is not configured.")
        if not model:
            raise WorkerError(f"Set the model for {provider.title()} in the project .env before starting Windows-Use.")
        return ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=base_url,
            timeout=float(os.getenv("COMMAND_CENTRE_WINDOWS_USE_LLM_TIMEOUT", "35")),
            max_retries=1,
            reasoning_effort="low",
        )

    api_key = os.getenv("COMMAND_CENTRE_PROXY_API_KEY") or os.getenv("CLIENT_KEY", "")
    if not api_key:
        raise WorkerError("Windows-Use proxy mode needs COMMAND_CENTRE_PROXY_API_KEY or CLIENT_KEY.")
    return ChatOpenAI(
        model=os.getenv("COMMAND_CENTRE_PROXY_MODEL", "gpt-5.6-luna"),
        api_key=api_key,
        base_url=os.getenv("COMMAND_CENTRE_PROXY_URL", "http://127.0.0.1:8317/v1"),
        timeout=float(os.getenv("COMMAND_CENTRE_WINDOWS_USE_LLM_TIMEOUT", "60")),
        max_retries=1,
        reasoning_effort="low",
    )


def _event_logger(event: Any) -> None:
    data = getattr(event, "data", {}) or {}
    event_type = getattr(getattr(event, "type", None), "value", getattr(event, "type", "event"))
    step = data.get("step", "?")
    tool = data.get("tool_name", "")
    detail = data.get("error") or data.get("content") or data.get("thought") or ""
    logger.info("Windows-Use %s step=%s tool=%s %s", event_type, step, tool, str(detail)[:500])


def _usable_completion(result: Any) -> bool:
    """Reject Windows-Use's conversational greeting as a desktop success."""
    content = str(getattr(result, "content", None) or "").strip().lower()
    if not content:
        return False
    generic = (
        "i'm ready to help",
        "i am ready to help",
        "what would you like me to do",
        "how can i help you",
        "hello!",
    )
    return not any(phrase in content for phrase in generic)


async def _run_agent(request: str, llm: Any, max_steps: int, timeout: int) -> Any:
    from windows_use import Agent

    configured_instructions = os.getenv("COMMAND_CENTRE_WINDOWS_USE_INSTRUCTIONS", "").strip()
    instructions = [configured_instructions] if configured_instructions else [
        "Complete the user's request on the visible Windows desktop using Windows-Use tools.",
        "For desktop tasks, do not use shell_tool, PowerShell, terminal commands, Start-Sleep, or notification substitutes. A timer request must create a real timer in the Windows Clock app.",
        "Use Windows UI Automation control patterns as the primary interaction method: invoke buttons, focus controls, and set values through accessibility APIs without moving the pointer whenever possible.",
        "When text entry or shortcuts are needed, use programmatic virtual keystrokes through the UI Automation SendKeys/PressKey path. Do not rely on the user's physical keyboard or ask the user to type.",
        "For opening an app, prefer the virtual Windows search shortcut, type the app name programmatically, and press Enter virtually. Use visible text and accessibility names.",
        "If a control exposes no UI Automation or keyboard route, use simulated pointer input only as a last resort. Never ask the user to move or click the physical mouse.",
        "After every changing action, inspect the updated desktop state. Do not repeat an action that did not change the state.",
        "If Windows denies foreground switching or an action reports an access error, do not claim success. Use UI Automation focus/invoke or virtual keyboard navigation instead, then verify the target window and visible result.",
        "Verify the requested end state before reporting completion. If the requested UI action cannot be completed, report the blocker truthfully instead of substituting a shell command.",
    ]
    agent = Agent(
        mode=os.getenv("COMMAND_CENTRE_WINDOWS_USE_MODE", "flash"),
        llm=llm,
        instructions=instructions,
        use_vision=False,
        use_annotation=False,
        use_accessibility=True,
        max_steps=max_steps,
        max_consecutive_failures=2,
        auto_minimize=False,
        log_to_console=False,
        log_to_file=False,
        event_subscriber=_event_logger,
        experimental=False,
    )
    logger.info(
        "Windows-Use starting provider=%s model=%s max_steps=%s",
        llm.provider,
        llm.model_name,
        max_steps,
    )
    return await asyncio.wait_for(agent.ainvoke(task=request), timeout=timeout)


async def run_windows_use_task(request: str) -> dict[str, Any]:
    """Run one approved task through Windows-Use's native agent loop."""
    if not enabled():
        raise WorkerError("Windows-Use is disabled in .env.")
    try:
        from windows_use import Agent
    except ImportError as exc:
        raise WorkerError(
            "Windows-Use is not installed in the backend environment. Run the backend dependency setup."
        ) from exc

    try:
        llm = _provider()
        max_steps = int(os.getenv("COMMAND_CENTRE_WINDOWS_USE_MAX_STEPS", "8"))
        timeout = int(os.getenv("COMMAND_CENTRE_WINDOWS_USE_TASK_TIMEOUT", "90"))
        result = await _run_agent(request, llm, max_steps, timeout)
        if getattr(result, "is_done", False) and not _usable_completion(result):
            logger.warning("Windows-Use returned a generic response without performing the desktop task")
            if os.getenv("COMMAND_CENTRE_WINDOWS_USE_PROVIDER", "proxy").lower() == "ollama" and os.getenv("COMMAND_CENTRE_WINDOWS_USE_FALLBACK_PROXY", "true").lower() in {"1", "true", "yes", "on"}:
                logger.info("Retrying the desktop task through CLIProxyAPI/Luna after unusable Ollama completion")
                result = await _run_agent(request, _provider("proxy"), max_steps, timeout)
            if not getattr(result, "is_done", False) or not _usable_completion(result):
                raise WorkerError("Windows-Use returned a response but did not confirm that the requested desktop action was performed.")
    except asyncio.TimeoutError as exc:
        raise WorkerError(f"Windows-Use stopped after {timeout} seconds without completing the desktop task.") from exc
    except WorkerError:
        raise
    except Exception as exc:
        logger.exception("Windows-Use failed")
        raise WorkerError(f"Windows-Use failed: {exc}") from exc

    if not getattr(result, "is_done", False):
        raise WorkerError(str(getattr(result, "error", None) or "Windows-Use did not confirm completion."))
    return {
        "completed": True,
        "summary": str(getattr(result, "content", None) or "Windows-Use completed the desktop task.")[:2000],
        "engine": "windows-use",
    }
