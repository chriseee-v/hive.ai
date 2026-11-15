import asyncio
import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

from .errors import WorkerError

logger = logging.getLogger(__name__)


WINDOWS_INTENT_TERMS = (
    "windows", "desktop", "computer", "laptop", "screen", "screenshot",
    "clock", "timer", "reminder", "file explorer", "downloads folder",
    "folder", "open app", "open the", "launch", "start app", "close app",
    "docker", "process", "installed", "system setting", "volume", "wifi",
    "bluetooth", "clipboard", "take a screenshot",
    "camera", "microphone", "browser", "downloads", "open downloads", "open browser", "open my browser", "powershell",
    "new file", "create file", "make a file", "write a file", "save a file",
    "type in", "type", "write", "enter", "click", "press a key", "keyboard",
)
WEB_INTENT_TERMS = (
    "search the web", "search online", "look up", "lookup", "latest", "current",
    "news", "weather", "forecast", "price", "stock", "research", "sources", "according to",
)


def is_windows_request(prompt: str) -> bool:
    """Safety router: desktop intent must never fall through to chat-only Ollama."""
    lowered = " ".join(prompt.lower().split())
    return any(term in lowered for term in WINDOWS_INTENT_TERMS)


def background_windows_path(prompt: str) -> str | None:
    """Recognize folder-opening requests that do not need screen interaction."""
    lowered = " ".join(prompt.lower().split())
    if not any(verb in lowered for verb in ("open", "show", "go to", "navigate to")):
        return None
    for name in ("downloads", "desktop", "documents"):
        if name in lowered:
            return name.title()
    return None


def is_web_request(prompt: str) -> bool:
    lowered = " ".join(prompt.lower().split())
    return any(term in lowered for term in WEB_INTENT_TERMS)


def _looks_like_local_action(prompt: str) -> bool:
    """Conservative parser fallback when a local model emits broken JSON."""
    lowered = " ".join(prompt.lower().split())
    verbs = ("open", "launch", "start", "close", "set", "create", "take", "check", "show", "find", "run")
    nouns = ("app", "browser", "camera", "clock", "timer", "folder", "file", "docker", "process", "screenshot", "desktop", "computer")
    return any(verb in lowered for verb in verbs) and any(noun in lowered for noun in nouns)


def _inherits_windows_context(prompt: str, context: str) -> bool:
    """Recognize short follow-ups whose desktop target is in prior chat."""
    if not context.strip() or not is_windows_request(context):
        return False
    lowered = " ".join(prompt.lower().split())
    return any(token in lowered for token in ("it", "that", "there", "again", "same", "open", "close", "set", "type", "click"))


def _needs_conversation_context(prompt: str) -> bool:
    lowered = " ".join(prompt.lower().split())
    return any(token in lowered for token in ("it", "that", "there", "again", "same", "previous", "earlier", "continue", "as before", "what did we"))


@dataclass
class Route:
    agent_id: str
    mode: str
    reason: str
    plan: list[str]


class OllamaClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("COMMAND_CENTRE_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
        self.model = os.getenv("COMMAND_CENTRE_OLLAMA_MODEL", "qwen3.5:4b")

    async def chat(self, messages: list[dict[str, str]], num_predict: int = 120, json_mode: bool = True) -> str:
        request_payload = {"model": self.model, "messages": messages, "stream": False, "think": False, "keep_alive": "10m", "options": {"temperature": 0.1, "num_predict": num_predict}}
        if json_mode:
            request_payload["format"] = "json"
        payload = json.dumps(request_payload).encode()

        def request() -> str:
            try:
                req = urllib.request.Request(f"{self.base_url}/api/chat", data=payload, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=25) as response:
                    body = json.loads(response.read().decode("utf-8"))
                    return body.get("message", {}).get("content", "")
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                raise WorkerError(f"Ollama is unavailable at {self.base_url}: {exc}") from exc

        return await asyncio.to_thread(request)


class ProxyClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("COMMAND_CENTRE_PROXY_URL", "http://127.0.0.1:8317/v1").rstrip("/")
        self.api_key = os.getenv("COMMAND_CENTRE_PROXY_API_KEY") or os.getenv("CLIENT_KEY", "")
        self.model = os.getenv("COMMAND_CENTRE_PROXY_MODEL", "gpt-5.6-luna")

    async def responses(self, prompt: str) -> str:
        if not self.api_key:
            raise WorkerError("CLIProxyAPI client key is not configured")
        payload = json.dumps({"model": self.model, "input": prompt}).encode()

        def request() -> str:
            try:
                req = urllib.request.Request(
                    f"{self.base_url}/responses",
                    data=payload,
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=120) as response:
                    body = json.loads(response.read().decode("utf-8"))
                    texts: list[str] = []
                    for item in body.get("output", []):
                        for content in item.get("content", []):
                            if content.get("type") == "output_text" and content.get("text"):
                                texts.append(content["text"])
                    return "\n".join(texts) or json.dumps(body)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                raise WorkerError(f"CLIProxyAPI is unavailable at {self.base_url}: {exc}") from exc

        return await asyncio.to_thread(request)


class LocalOrchestrator:
    def __init__(self) -> None:
        self.client = OllamaClient()

    @staticmethod
    def _plan(value: object) -> list[str]:
        if isinstance(value, str):
            return [value] if value.strip() else []
        if isinstance(value, list):
            return [str(item) for item in value[:4] if str(item).strip()]
        return []

    async def route(self, prompt: str) -> Route:
        system = """You are the router for an AI Command Centre. Return JSON only with keys: mode, agent_id, reason, plan. mode must be local, cloud, or both. agent_id must be ollama, proxy, or hybrid. Use local/ollama for general reasoning, drafting, summarization, and private/offline work. Use cloud/proxy for difficult coding, repository inspection, tool use, or tasks explicitly needing the stronger Codex model. Use both/hybrid when local analysis or planning should be passed to the cloud agent for execution or review. Never choose cloud merely because a task is conversational. Keep plan to at most 4 short steps. Never claim an action was performed."""
        try:
            raw = await self.client.chat([{"role": "system", "content": system}, {"role": "user", "content": prompt}])
            start, end = raw.find("{"), raw.rfind("}")
            data = json.loads(raw[start:end + 1]) if start >= 0 and end > start else {}
            fallback = self._fallback(prompt)
            mode = data.get("mode") if data.get("mode") in {"local", "cloud", "both"} else fallback.mode
            agent_id = data.get("agent_id") if data.get("agent_id") in {"ollama", "proxy", "hybrid"} else fallback.agent_id
            return Route(mode=mode, agent_id=agent_id, reason=str(data.get("reason", "Local model route")), plan=self._plan(data.get("plan", [])))
        except (WorkerError, json.JSONDecodeError, TypeError, ValueError):
            return self._fallback(prompt)

    async def decide(self, prompt: str, context: str = "") -> tuple[Route, dict | None]:
        """Route locally; let the subscribed Luna model clarify only missed action plans."""
        from .local_tools import catalog

        # Desktop intent is deterministic and must not wait for a second
        # Ollama classification round. Windows-Use performs the actual
        # semantic planning against the live desktop.
        background_path = background_windows_path(prompt)
        if background_path:
            return Route(
                "hybrid",
                "local_tool",
                "Recognized a background-safe Windows folder action; using the native shell without screen capture.",
                ["Resolve the requested Windows folder", "Open it with the native shell"],
            ), {"tool": "open_windows_path", "arguments": {"path": background_path}}

        if is_windows_request(prompt) or _inherits_windows_context(prompt, context):
            return Route(
                "hybrid",
                "windows_desktop",
                "Detected a Windows desktop request; selected the local Windows desktop agent.",
                ["Inspect the active Windows desktop", "Perform the requested action locally", "Verify the visible result"],
            ), {"tool": "windows_mcp_task", "arguments": {"request": prompt}}

        if is_web_request(prompt):
            return Route("langsearch", "web", "The request asks for current or web-sourced information; selected LangSearch.", ["Search the web with LangSearch", "Collect relevant sources", "Return the answer with source links"]), None

        tools = catalog()
        # Live MCP discovery happens only after approval inside the desktop worker.
        # Starting uvx merely to decide a route made every request visibly slow.
        tool_help = "\n".join(f"- {item['name']}: {item['description']}" for item in tools)
        system = f"""You are the local AI Command Centre orchestrator running on Windows. Return one JSON object with keys needs_action, mode, agent_id, reason, plan, tool, arguments. needs_action is true whenever the user wants the computer checked or changed, including questions such as 'is Docker installed?', 'check whether X is running', 'open...', 'start...', or 'show me...'. Such requests are actions even when phrased as questions. For normal advice set needs_action=false and tool=null. mode is local/cloud/both. agent_id is ollama/proxy/hybrid. Choose only an exact tool name from this live registered tool list and use its stated argument names:
{tool_help}
Any request involving the Windows computer, a Windows app, desktop UI, timer, reminder, system setting, installed program, local process, screenshot, shell, file explorer, or Docker must use tool=windows_mcp_task with arguments={{"request": exact original user request}}. Do not substitute another tool for those requests. If needs_action=true but you cannot confidently choose a registered tool, set tool=null; Luna can help choose. Only broad or irreversible deletion requires human approval; ordinary actions should run directly. Never claim a tool has run."""
        try:
            model_prompt = prompt
            if context.strip() and _needs_conversation_context(prompt):
                model_prompt += "\n\nRecent conversation context (use only to resolve references; the current request remains authoritative):\n" + context.strip()[:12000]
            raw = await self.client.chat([{"role": "system", "content": system}, {"role": "user", "content": model_prompt}])
            start, end = raw.find("{"), raw.rfind("}")
            data = json.loads(raw[start:end + 1]) if start >= 0 and end > start else {}
        except (WorkerError, json.JSONDecodeError, TypeError, ValueError) as exc:
            # A malformed router response must never make a valid desktop task
            # disappear. Route obvious local actions directly to Windows-Use;
            # ordinary prompts still use the safe local fallback.
            logger.warning("orchestrator response was unusable; applying safe fallback: %s", exc)
            fallback = self._fallback(prompt)
            if is_windows_request(prompt) or _looks_like_local_action(prompt):
                return Route("hybrid", "windows_desktop", "The local router response was malformed; selected the Windows desktop agent from the request.", ["Inspect the active Windows desktop", "Perform the requested action locally", "Verify the visible result"]), {"tool": "windows_mcp_task", "arguments": {"request": prompt}}
            return fallback, None
        fallback = self._fallback(prompt)
        mode = data.get("mode") if data.get("mode") in {"local", "cloud", "both"} else fallback.mode
        agent_id = data.get("agent_id") if data.get("agent_id") in {"ollama", "proxy", "hybrid"} else fallback.agent_id
        route = Route(agent_id, mode, str(data.get("reason", "Chosen by the local orchestrator")), self._plan(data.get("plan", [])))
        tool_name = data.get("tool")
        allowed = {item["name"] for item in tools}
        proposal = {"tool": tool_name, "arguments": data.get("arguments", {})} if tool_name in allowed else None
        if data.get("needs_action") is True and proposal is None:
            assist = f"""You are a tool-planning assistant for a local Windows agent. The user asked for a computer action. Return JSON only: {{\"tool\": registered_name, \"arguments\": {{...}}}} or {{\"tool\": null, \"reason\": why unsupported}}. Select only from this live registered tool list and use its argument names exactly:
{tool_help}
For any Windows or local-machine request, use windows_mcp_task with arguments {{"request": exact original user request}}. Never use another tool for a Windows task. Never claim execution. Never propose destructive actions unless the user's request explicitly asks for them."""
            cloud_text = await ProxyClient().responses(assist + "\n\nUser request: " + prompt)
            start, end = cloud_text.find("{"), cloud_text.rfind("}")
            cloud_data = json.loads(cloud_text[start:end + 1]) if start >= 0 and end > start else {}
            cloud_tool = cloud_data.get("tool")
            if cloud_tool in allowed:
                proposal = {"tool": cloud_tool, "arguments": cloud_data.get("arguments", {})}
                route = Route("proxy", "both", "Local model recognized a system action; Luna helped select a registered local tool. The tool will run locally unless it is a broad or irreversible deletion.", route.plan)
        return route, proposal

    async def plan_tool(self, prompt: str) -> dict | None:
        """Return a validated registered-tool proposal, never executable shell text."""
        from .local_tools import catalog
        tool_help = "\n".join(f"- {item['name']}: {item['description']}" for item in catalog())
        system = f"""You are a tool-using Windows desktop agent. Infer the user's intended action and select the single best registered tool. Return strict JSON only: {{\"tool\":null}} for ordinary questions, or {{\"tool\":\"registered_name\",\"arguments\":{{...}}}} for an action. Use only these registered tools and their descriptions:
{tool_help}
For every Windows or local-machine request, use windows_mcp_task with arguments {{"request": exact original user request}}. Never invent tool names or provide shell command strings. Only broad or irreversible deletion requires human approval; ordinary actions should run directly."""
        raw = await self.client.chat([{"role":"system","content":system},{"role":"user","content":prompt}])
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start:end + 1]) if start >= 0 and end > start else {}
        name = data.get("tool")
        allowed = {item["name"] for item in catalog()}
        if name not in allowed:
            return None
        return {"tool": name, "arguments": data.get("arguments", {})}

    async def repair_tool_proposal(self, prompt: str, proposal: dict, error: str) -> tuple[dict | None, str]:
        """Ask the local model for one same-tool correction; never execute its proposal here."""
        from .local_tools import catalog

        tool_name = str(proposal.get("tool", ""))
        tool_spec = next((item for item in catalog() if item["name"] == tool_name), None)
        if tool_spec is None:
            return None, "The failed tool is no longer registered."
        system = f"""You diagnose failed local tool calls. Return JSON only with keys `tool`, `arguments`, `explanation`, and `can_repair`. You may only correct arguments for the SAME tool named below. Preserve the user's intent exactly; do not add actions, widen scope, or invent values. If the failure may have happened after a side effect, or you cannot confidently correct it from the user request and tool description, set can_repair=false. The action will not run until the user reviews and approves any changed proposal. Tool description: {tool_spec['description']}. For a relative timer use delay_seconds, not at."""
        user = json.dumps({
            "user_request": prompt,
            "failed_tool": tool_name,
            "failed_arguments": proposal.get("arguments", {}),
            "error": error[:2000],
        }, ensure_ascii=True)
        try:
            raw = await self.client.chat([{"role": "system", "content": system}, {"role": "user", "content": user}])
            start, end = raw.find("{"), raw.rfind("}")
            data = json.loads(raw[start:end + 1]) if start >= 0 and end > start else {}
            arguments = data.get("arguments")
            if data.get("can_repair") is not True or data.get("tool") != tool_name or not isinstance(arguments, dict):
                return None, str(data.get("explanation") or "The local model could not find a safe correction.")[:500]
            corrected = {"tool": tool_name, "arguments": arguments}
            if corrected == proposal:
                return None, "The local model found no argument changes to try."
            return corrected, str(data.get("explanation") or "The local model corrected the tool arguments.")[:500]
        except (WorkerError, json.JSONDecodeError, TypeError, ValueError) as exc:
            return None, f"Local repair was unavailable: {exc}"[:500]

    def _fallback(self, prompt: str) -> Route:
        lowered = prompt.lower()
        code_words = ("edit", "create file", "modify", "run command", "debug", "implement", "code")
        if any(word in lowered for word in ("both", "analyze and implement", "plan and build", "review and fix")):
            return Route("hybrid", "both", "The request benefits from local planning followed by cloud execution or review.", ["Analyze locally", "Request approval", "Execute or review with the cloud agent"])
        if any(word in lowered for word in code_words):
            return Route("proxy", "cloud", "The request appears to require project or code changes.", ["Review the requested scope", "Request approval", "Run the approved cloud task"])
        return Route("ollama", "local", "The request is suitable for local reasoning and drafting.", ["Understand the request", "Produce a concise local response"])

