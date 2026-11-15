import asyncio
import json
import logging
import os
import uuid
import re
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any


def _load_project_env() -> None:
    """Load simple project .env values for direct Uvicorn starts as well as the launcher."""
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ[key] = value


_load_project_env()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

if os.name == "nt" and hasattr(asyncio, "WindowsProactorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Body
from fastapi.middleware.cors import CORSMiddleware

from .agents import CodexWorker, DemoWorker, HandySTT, HybridWorker, LangSearchWorker, OllamaWorker, ProxyWorker, WorkerError, handy_stt
from .models import Agent, AgentState, ApprovalDecision, Event, Task, TaskCreate
from .orchestrator import LocalOrchestrator
from .local_tools import ToolProposal, catalog as local_tool_catalog, execute as execute_local_tool, requires_approval, requires_major_deletion_approval
from .memory import context_for, remember_task_outcome, should_recall_context, status as memory_status


agents = {
    "demo": Agent(id="demo", name="Local Demo", kind="demo", description="Deterministic local worker", state=AgentState.idle, requires_approval=False),
    "codex": Agent(id="codex", name="Codex CLI", kind="codex", description="Opt-in local Codex CLI adapter"),
    "ollama": Agent(id="ollama", name="Ollama", kind="ollama", description="Optional local inference adapter", state=AgentState.idle),
    "proxy": Agent(id="proxy", name="CLIProxyAPI / Codex", kind="proxy", description="Approval-gated local proxy to Codex", state=AgentState.idle),
    "hybrid": Agent(id="hybrid", name="Hybrid Router", kind="hybrid", description="Local analysis plus approved cloud execution", state=AgentState.idle),
    "langsearch": Agent(id="langsearch", name="LangSearch", kind="langsearch", description="Current web research with source links", state=AgentState.idle),
}
tasks: dict[str, Task] = {}
subscribers: dict[str, set[asyncio.Queue[str]]] = defaultdict(set)
tool_proposals: dict[str, ToolProposal] = {}
running_jobs: dict[str, asyncio.Task[Any]] = {}
logger = logging.getLogger(__name__)


def windows_mcp_auto_approve() -> bool:
    value = os.getenv("COMMAND_CENTRE_WINDOWS_AUTO_APPROVE", os.getenv("COMMAND_CENTRE_WINDOWS_MCP_AUTO_APPROVE", "false"))
    return value.lower() in {
        "1", "true", "yes", "on"
    }


async def publish(event: Event) -> None:
    message = event.model_dump_json()
    for queue in list(subscribers[event.task_id]):
        await queue.put(message)


def launch_job(task_id: str, coroutine: Any) -> asyncio.Task[Any]:
    job = asyncio.create_task(coroutine)
    running_jobs[task_id] = job
    job.add_done_callback(lambda _: running_jobs.pop(task_id, None))
    return job


def snapshot(task: Task) -> dict:
    return task.model_dump(mode="json")


async def prepare_task(task_id: str, requested_agent: str, context: str = "") -> None:
    """Plan in the background so the dashboard can show routing immediately."""
    task = tasks[task_id]
    if task.status == "cancelled":
        return
    router_name = f"Local Router · {OllamaWorker().model}"
    logger.info("[%s] routing started: %s", task_id, task.prompt[:120])
    try:
        await publish(Event(type="task.routing", task_id=task_id, payload={
            "text": f"{router_name} is selecting the execution path.", "snapshot": snapshot(task),
        }))
        route, proposal_data = await LocalOrchestrator().decide(task.prompt, context)
        logger.info("[%s] route decided: agent=%s mode=%s tool=%s", task_id, route.agent_id, route.mode, (proposal_data or {}).get("tool"))
        if proposal_data:
            proposal = ToolProposal.model_validate(proposal_data)
            spec = next((item for item in local_tool_catalog() if item["name"] == proposal.tool), None)
            if spec is None:
                raise WorkerError("The selected tool is no longer registered")
            task.agent_id = "hybrid"
            task.mode = "windows_desktop" if proposal.tool == "windows_mcp_task" else "local_tool"
            task.reason = route.reason
            task.plan = route.plan or [f"Prepare {proposal.tool}", "Run the local action", "Verify the result"]
            task.tool_proposal = proposal.model_dump()
            if proposal.tool == "windows_mcp_task" and should_recall_context(task.prompt):
                remembered = await context_for(task.prompt)
                if remembered:
                    proposal.arguments["request"] = f"{task.prompt}\n\n{remembered}"
                    task.tool_proposal = proposal.model_dump()
                    logger.info("[%s] attached persistent memory context to desktop task", task_id)
            task.approval_required = requires_approval(proposal)
            task.status = "awaiting_approval" if task.approval_required else "running"
            execution_agent = "Windows background agent" if proposal.tool == "open_windows_path" else "Windows desktop agent"
            await publish(Event(type="task.route_selected", task_id=task_id, payload={
                "text": f"Selected {execution_agent}. {task.reason}", "agent": execution_agent, "snapshot": snapshot(task),
            }))
            if task.approval_required:
                logger.info("[%s] waiting for dashboard approval: tool=%s", task_id, proposal.tool)
                await publish(Event(type="task.awaiting_approval", task_id=task_id, payload={
                    "text": "Windows desktop agent is ready. Review the requested action before it controls the desktop.", "snapshot": snapshot(task),
                }))
                return
            await publish(Event(type="task.started", task_id=task_id, payload={
                "text": "No major deletion detected; starting the local desktop worker.",
                "agent": execution_agent, "snapshot": snapshot(task),
            }))
            if task.status == "cancelled":
                return
            result = await execute_local_tool(proposal)
            task.status = "completed"
            task.result = result if isinstance(result, str) else json.dumps(result)
            await publish(Event(type="task.completed", task_id=task_id, payload={"result": task.result, "snapshot": snapshot(task)}))
            logger.info("[%s] completed local tool: %s", task_id, proposal.tool)
            asyncio.create_task(remember_task_outcome(task.prompt, task.result))
            return

        if requested_agent in {"ollama", "proxy"}:
            route.agent_id = requested_agent
            route.mode = "local" if requested_agent == "ollama" else "cloud"
            route.reason = f"Using the model selected in the command composer ({requested_agent})."
        if route.agent_id not in agents:
            raise WorkerError(f"The router selected an unavailable agent: {route.agent_id}")
        task.agent_id, task.mode, task.reason, task.plan = route.agent_id, route.mode, route.reason, route.plan
        agent = agents[task.agent_id]
        task.approval_required = requires_major_deletion_approval(task.prompt)
        task.status = "awaiting_approval" if task.approval_required else "queued"
        await publish(Event(type="task.route_selected", task_id=task_id, payload={
            "text": f"Selected {agent.name}. {task.reason}", "agent": agent.name, "snapshot": snapshot(task),
        }))
        if task.approval_required:
            await publish(Event(type="task.awaiting_approval", task_id=task_id, payload={"text": f"{agent.name} is ready after approval.", "snapshot": snapshot(task)}))
        else:
            launch_job(task_id, execute(task_id))
    except asyncio.CancelledError:
        task.status = "cancelled"
        task.error = "Stopped by the user."
        await publish(Event(type="task.cancelled", task_id=task_id, payload={"error": task.error, "snapshot": snapshot(task)}))
        raise
    except (WorkerError, ValueError, TypeError, TimeoutError) as exc:
        logger.error("[%s] routing failed: %s", task_id, exc)
        task.status = "failed"
        task.error = f"Routing failed: {exc}"
        await publish(Event(type="task.failed", task_id=task_id, payload={"error": task.error, "snapshot": snapshot(task)}))


async def execute(task_id: str) -> None:
    task = tasks[task_id]
    agent = agents[task.agent_id]
    agent.state = AgentState.running
    task.status = "running"
    await publish(Event(type="task.started", task_id=task_id, payload={"agent_id": agent.id, "agent": agent.name, "text": f"{agent.name} started.", "snapshot": snapshot(task)}))
    workers = {"demo": DemoWorker(), "codex": CodexWorker(), "ollama": OllamaWorker(), "proxy": ProxyWorker(), "hybrid": HybridWorker(), "langsearch": LangSearchWorker()}
    try:
        async for chunk in workers[agent.kind].run(task.prompt):
            task.result = (task.result or "") + chunk + "\n"
            await publish(Event(type="task.progress", task_id=task_id, payload={"text": chunk, "agent": agent.name}))
        task.status = "completed"
        agent.state = AgentState.idle
        await publish(Event(type="task.completed", task_id=task_id, payload={"result": task.result, "agent": agent.name, "snapshot": snapshot(task)}))
    except asyncio.CancelledError:
        task.status = "cancelled"
        task.error = "Stopped by the user."
        agent.state = AgentState.idle
        await publish(Event(type="task.cancelled", task_id=task_id, payload={"error": task.error, "agent": agent.name, "snapshot": snapshot(task)}))
        raise
    except WorkerError as exc:
        task.status = "failed"
        task.error = str(exc)
        agent.state = AgentState.idle
        await publish(Event(type="task.failed", task_id=task_id, payload={"error": task.error, "agent": agent.name, "snapshot": snapshot(task)}))


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(title="AI Command Centre API", version="0.1.0", lifespan=lifespan)
_frontend_origins = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    *filter(None, (origin.strip() for origin in os.getenv("COMMAND_CENTRE_FRONTEND_ORIGINS", "").split(","))),
}
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(_frontend_origins),
    # Permit the Vite dev ports from localhost and private LAN addresses.
    allow_origin_regex=(
        r"^https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
        r"192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):30\d{2}$"
    ),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    import subprocess
    import time
    docker_available = False
    try:
        subprocess.run(["docker", "--version"], capture_output=True, text=True, timeout=5)
        docker_available = True
    except Exception:
        docker_available = False
    # Check Codex process status
    codex_worker = CodexWorker()
    codex_info = codex_worker.get_process_info()
    # Check Ollama connectivity
    ollama_worker = OllamaWorker()
    ollama_enabled = ollama_worker.enabled
    ollama_model = ollama_worker.model
    # Check ChatGPT/OpenAI key status
    openai_key = os.getenv("OPEN_ROUTER_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    # Get all agent states
    agent_states = {}
    for agent_id, agent in agents.items():
        agent_states[agent_id] = {
            "name": agent.name,
            "state": agent.state.value,
            "kind": agent.kind,
        }
    return {"status": "ok", "mode": "in-memory",
            "codex_enabled": codex_worker.enabled,
            "codex_running": codex_info["running"],
            "codex_process_info": codex_info,
            "ollama_enabled": ollama_enabled, "ollama_model": ollama_model,
            "proxy_enabled": ProxyWorker().enabled,
            "windows_use_enabled": os.getenv("COMMAND_CENTRE_WINDOWS_USE_ENABLED", "true").lower() in {"1", "true", "yes", "on"},
            "windows_auto_approve": windows_mcp_auto_approve(),
            "docker_available": docker_available,
            "openai_api_key_configured": bool(openai_key),
            "agents": agent_states,
            "handy_stt": {
                "available": handy_stt.handy_cli_available,
                "mode": handy_stt.transcription_mode,
                "model": handy_stt.model_size,
                "listening": handy_stt.is_listening,
                "last_transcription": handy_stt.last_transcription[:100] if handy_stt.last_transcription else "",
            }}


@app.get("/api/handy/status")
async def handy_status():
    """Get Handy STT status and listening state."""
    return handy_stt.get_status()


@app.post("/api/handy/transcribe")
async def handy_transcribe(audio_file: str = Body(...)):
    """Transcribe audio using Handy CLI.
    
    Args:
        audio_file: Path to the audio file to transcribe
        
    Returns:
        Transcribed text
    """
    try:
        result = await handy_stt.transcribe_from_handy(audio_file)
        return {"transcribed_text": result, "status": "success"}
    except WorkerError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/orchestrator/status")
async def orchestrator_status():
    worker = OllamaWorker()
    from .windows_mcp import _find_launcher
    configured = os.getenv("COMMAND_CENTRE_WINDOWS_MCP_COMMAND", "uvx")
    launcher, checked = _find_launcher(configured)
    return {"enabled": worker.enabled, "model": worker.model, "url": os.getenv("COMMAND_CENTRE_OLLAMA_URL", "http://127.0.0.1:11434"), "proxy_enabled": ProxyWorker().enabled, "proxy_url": os.getenv("COMMAND_CENTRE_PROXY_URL", "http://127.0.0.1:8317/v1"), "langsearch_enabled": bool(os.getenv("LANGSEARCH_API_KEY", "").strip()), "windows_use_enabled": os.getenv("COMMAND_CENTRE_WINDOWS_USE_ENABLED", "true").lower() in {"1", "true", "yes", "on"}, "windows_use_provider": os.getenv("COMMAND_CENTRE_WINDOWS_USE_PROVIDER", "proxy"), "approval_policy": "major_deletion_only", "memory": memory_status(), "windows_mcp_enabled": os.getenv("COMMAND_CENTRE_WINDOWS_MCP_ENABLED", "false").lower() in {"1", "true", "yes", "on"}, "windows_mcp_headless": os.getenv("COMMAND_CENTRE_WINDOWS_MCP_HEADLESS", "false").lower() in {"1", "true", "yes", "on"}, "windows_mcp_auto_approve": True, "windows_mcp_launcher": configured, "windows_mcp_launcher_checked": checked[:8], "windows_mcp_launcher_ready": bool(launcher)}


@app.post("/api/memory/recall")
async def memory_recall(body: dict[str, Any]):
    from .memory import recall

    query = str(body.get("query", "")).strip()
    if not query:
        raise HTTPException(400, "Memory query is required")
    return {"query": query, "items": await recall(query)}


@app.post("/api/memory/remember")
async def memory_remember(body: dict[str, Any]):
    from .memory import remember

    content = str(body.get("content", "")).strip()
    if not content:
        raise HTTPException(400, "Memory content is required")
    return await remember(content, kind=str(body.get("kind", "fact")), verified=bool(body.get("verified", False)))


@app.post("/api/orchestrate", response_model=Task, status_code=202)
async def orchestrate(body: TaskCreate):
    requested_agent = body.agent_id
    task = Task(
        id=str(uuid.uuid4()), prompt=body.prompt, agent_id="router", status="routing", mode="routing",
        reason=f"Local Router · {OllamaWorker().model} is classifying the request.",
        plan=["Understand the request", "Select the agent", "Prepare the next action"],
    )
    tasks[task.id] = task
    launch_job(task.id, prepare_task(task.id, requested_agent, body.context))
    return task


@app.post("/api/tasks/{task_id}/cancel", response_model=Task)
async def cancel_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(404, "Unknown task")
    task = tasks[task_id]
    if task.status in {"completed", "failed", "rejected", "cancelled"}:
        return task
    task.status = "cancelled"
    task.error = "Stopped by the user."
    job = running_jobs.get(task_id)
    if job and not job.done():
        job.cancel()
    await publish(Event(type="task.cancelled", task_id=task_id, payload={"error": task.error, "snapshot": snapshot(task)}))
    logger.info("[%s] task cancelled by user", task_id)
    return task


@app.get("/api/agents", response_model=list[Agent])
async def list_agents():
    return list(agents.values())


@app.get("/api/tools")
async def list_tools():
    return {"execution_enabled": True, "approval_policy": "major_deletion_only", "approval_required_for_mutations": False, "tools": local_tool_catalog()}


@app.get("/api/docker/status")
async def docker_status():
    """Check Docker daemon status and list containers."""
    import subprocess
    import json
    try:
        result = subprocess.run(
            ["docker", "ps", "--all", "--format", "{{json .}}"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return {"docker_running": False, "error": result.stderr or "Docker command failed"}
        containers = []
        for line in result.stdout.strip().splitlines():
            if not line:
                continue
            try:
                containers.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        return {"docker_running": True, "containers": containers}
    except Exception as e:
        return {"docker_running": False, "error": str(e)}


@app.post("/api/docker/action")
async def docker_action(body: dict[str, Any]):
    """Run a docker action: list, inspect, pause, unpause, stats."""
    import subprocess
    import json
    action = body.get("action", "")
    if action not in {"list", "inspect", "pause", "unpause", "stats"}:
        raise HTTPException(400, f"Unknown docker action. Must be one of: list, inspect, pause, unpause, stats")
    try:
        if action == "list":
            result = subprocess.run(
                ["docker", "ps", "--all", "--format", "{{.ID}} {{.Names}} {{.Status}}"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                raise HTTPException(500, result.stderr or "Docker command failed")
            containers = []
            for line in result.stdout.strip().splitlines():
                if not line:
                    continue
                parts = line.split(" ", 2)
                containers.append({"id": parts[0] if len(parts) > 0 else "", "name": parts[1] if len(parts) > 1 else "", "status": parts[2] if len(parts) > 2 else ""})
            return {"action": "list", "containers": containers}
        elif action == "inspect":
            container_id = body.get("container_id", "")
            if not container_id:
                raise HTTPException(400, "container_id is required")
            result = subprocess.run(
                ["docker", "inspect", "--format", "{{json .State}} {{.Name}}", container_id],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                raise HTTPException(500, result.stderr or "Docker inspect failed")
            return {"action": "inspect", "output": result.stdout}
        elif action == "pause":
            container_id = body.get("container_id", "")
            if not container_id:
                raise HTTPException(400, "container_id is required")
            result = subprocess.run(["docker", "pause", container_id], capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                raise HTTPException(500, result.stderr or "Docker pause failed")
            return {"action": "pause", "container_id": container_id, "success": True}
        elif action == "unpause":
            container_id = body.get("container_id", "")
            if not container_id:
                raise HTTPException(400, "container_id is required")
            result = subprocess.run(["docker", "unpause", container_id], capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                raise HTTPException(500, result.stderr or "Docker unpause failed")
            return {"action": "unpause", "container_id": container_id, "success": True}
        elif action == "stats":
            result = subprocess.run(
                ["docker", "stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}} {{.MemUsage}} {{.NetIO}} {{.BlockIO}}"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                raise HTTPException(500, result.stderr or "Docker stats failed")
            stats = []
            for line in result.stdout.strip().splitlines():
                if not line:
                    continue
                parts = line.split(" ", 4)
                stats.append({"name": parts[0] if len(parts) > 0 else "", "cpu_percent": parts[1] if len(parts) > 1 else "0", "mem_usage": parts[2] if len(parts) > 2 else "0", "net_io": parts[3] if len(parts) > 3 else "0", "block_io": parts[4] if len(parts) > 4 else "0"})
            return {"action": "stats", "stats": stats}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── ChatGPT research activity tracking ──
class ChatGPTResearchTracker:
    """Track research activity from ChatGPT/OpenAI accounts."""
    
    def __init__(self) -> None:
        self.openai_api_key = os.getenv("OPEN_ROUTER_API_KEY") or os.getenv("OPENAI_API_KEY", "")
        self.research_queries: list[dict[str, Any]] = []
        self._last_check = 0
    
    async def check_recent_research(self) -> list[dict[str, Any]]:
        """Check for recent ChatGPT research activity.
        
        Note: This requires OPEN_ROUTER_API_KEY or OPENAI_API_KEY set env vars.
        In production, you'd integrate with OpenAI's usage API or ChatGPT history.
        """
        results = []
        if not self.openai_api_key:
            return results
        
        # Placeholder: In a real implementation, you would:
        # 1. Query OpenAI's usage/billing API for recent completions
        # 2. Check ChatGPT search history if available
        # 3. Look at recent conversations/sessions
        # For now, we return available metadata
        results.append({
            "source": "openai_api_key_configured",
            "has_key": bool(self.openai_api_key),
            "note": "Set OPEN_ROUTER_API_KEY or OPENAI_API_KEY to enable actual research tracking",
        })
        return results


tracker = ChatGPTResearchTracker()


@app.get("/api/chatgpt/research")
async def chatgpt_research():
    """Check if research was done on ChatGPT about specific topics."""
    import time
    # Accept optional topic parameter via query string (not used yet, placeholder)
    # We'll just return the current state
    results = await tracker.check_recent_research()
    return {"tracker_status": "configured" if tracker.openai_api_key else "no_key", "recent_research": results}


@app.get("/api/system/status")
async def system_status():
    """Get comprehensive system status including agent and process monitoring."""
    import time
    
    # Codex process status
    codex_worker = CodexWorker()
    codex_info = codex_worker.get_process_info()
    
    # Ollama status
    ollama_worker = OllamaWorker()
    ollama_enabled = ollama_worker.enabled
    ollama_model = ollama_worker.model
    
    # Proxy status
    proxy_worker = ProxyWorker()
    proxy_enabled = proxy_worker.enabled
    
    # Agent states
    agent_details = {}
    for agent_id, agent in agents.items():
        agent_details[agent_id] = {
            "id": agent.id,
            "name": agent.name,
            "kind": agent.kind,
            "state": agent.state.value,
            "description": agent.description,
            "requires_approval": agent.requires_approval,
        }
    
    # ChatGPT API key status
    openai_key = os.getenv("OPEN_ROUTER_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    
    return {
        "codex": {
            "enabled": codex_worker.enabled,
            "running": codex_info["running"],
            "process_info": codex_info,
        },
        "ollama": {
            "enabled": ollama_enabled,
            "model": ollama_model,
        },
        "proxy": {
            "enabled": proxy_enabled,
        },
        "agents": agent_details,
        "openai_api_key_configured": bool(openai_key),
    }


@app.get("/api/agents/detailed")
async def detailed_agents():
    """Get detailed agent status including Codex and Docker integration."""
    import subprocess
    
    docker_status_result = "unknown"
    try:
        result = subprocess.run(["docker", "ps", "--format", "{{.Names}}"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            docker_status_result = result.stdout.strip().splitlines() if result.stdout.strip() else []
    except Exception:
        pass
    
    detailed = []
    for agent_id, agent in agents.items():
        # Check if Codex worker can run
        codex_enabled = os.getenv("COMMAND_CENTRE_CODEX_ENABLED", "false").lower() == "true"
        detailed.append({
            "id": agent.id,
            "name": agent.name,
            "kind": agent.kind,
            "state": agent.state.value,
            "description": agent.description,
            "requires_approval": agent.requires_approval,
            "codex_enabled": codex_enabled,
            "docker_containers_running": len(docker_status_result) if isinstance(docker_status_result, list) else 0,
        })
    return {"agents": detailed, "docker_status": docker_status_result}


@app.post("/api/tools/proposals", status_code=202)
async def propose_tool(body: ToolProposal):
    known = {item["name"]: item for item in local_tool_catalog()}
    spec = known.get(body.tool)
    if not spec:
        raise HTTPException(400, "Unknown tool")
    proposal_id = str(uuid.uuid4())
    tool_proposals[proposal_id] = body
    if requires_approval(body):
        return {"id": proposal_id, "status": "awaiting_approval", "tool": body.tool, "arguments": body.arguments, "approval_required": True}
    try:
        result = await execute_local_tool(body)
        return {"id": proposal_id, "status": "completed", "tool": body.tool, "result": result, "approval_required": False}
    except WorkerError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/tools/proposals/{proposal_id}/approval")
async def approve_tool(proposal_id: str, body: ApprovalDecision):
    proposal = tool_proposals.pop(proposal_id, None)
    if proposal is None:
        raise HTTPException(404, "Unknown or already decided proposal")
    if not body.approved:
        return {"id": proposal_id, "status": "rejected", "tool": proposal.tool}
    try:
        result = await execute_local_tool(proposal)
        return {"id": proposal_id, "status": "completed", "tool": proposal.tool, "result": result}
    except WorkerError as exc:
        return {"id": proposal_id, "status": "failed", "tool": proposal.tool, "error": str(exc)}


@app.post("/api/agents/{agent_id}/start", response_model=Agent)
async def start_agent(agent_id: str):
    if agent_id not in agents:
        raise HTTPException(404, "Unknown agent")
    agents[agent_id].state = AgentState.idle
    return agents[agent_id]


@app.post("/api/agents/{agent_id}/stop", response_model=Agent)
async def stop_agent(agent_id: str):
    if agent_id not in agents:
        raise HTTPException(404, "Unknown agent")
    agents[agent_id].state = AgentState.stopped
    return agents[agent_id]


@app.post("/api/tasks", response_model=Task, status_code=202)
async def create_task(body: TaskCreate):
    if body.agent_id not in agents:
        raise HTTPException(404, "Unknown agent")
    agent = agents[body.agent_id]
    if agent.state == AgentState.stopped:
        raise HTTPException(409, "Agent is stopped")
    task_id = str(uuid.uuid4())
    requires = requires_major_deletion_approval(body.prompt) and not body.approved
    task = Task(id=task_id, prompt=body.prompt, agent_id=body.agent_id, approval_required=requires)
    tasks[task_id] = task
    if requires:
        task.status = "awaiting_approval"
        await publish(Event(type="task.awaiting_approval", task_id=task_id))
    else:
        launch_job(task_id, execute(task_id))
    return task


@app.get("/api/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(404, "Unknown task")
    return tasks[task_id]


async def execute_approved_tool(task_id: str) -> None:
    task = tasks[task_id]
    try:
        logger.info("[%s] approval received; starting approved tool=%s", task_id, task.tool_proposal.get("tool"))
        await publish(Event(type="task.started", task_id=task_id, payload={
            "agent": "Windows Desktop Agent", "text": "Starting the approved Windows desktop worker.", "snapshot": snapshot(task),
        }))
        result = await execute_local_tool(ToolProposal.model_validate(task.tool_proposal))
        task.status = "completed"
        task.result = result if isinstance(result, str) else json.dumps(result)
        await publish(Event(type="task.completed", task_id=task_id, payload={"result": task.result, "snapshot": snapshot(task)}))
        logger.info("[%s] approved tool completed", task_id)
        asyncio.create_task(remember_task_outcome(task.prompt, task.result))
    except asyncio.CancelledError:
        task.status = "cancelled"
        task.error = "Stopped by the user."
        await publish(Event(type="task.cancelled", task_id=task_id, payload={"error": task.error, "snapshot": snapshot(task)}))
        raise
    except Exception as exc:
        if not isinstance(exc, (WorkerError, ValueError, TypeError, OSError)):
            logger.exception("Unexpected error while executing approved tool %s", task.tool_proposal.get("tool"))
        if task.tool_proposal.get("tool") == "windows_mcp_task":
            task.status = "failed"
            task.error = f"Windows desktop agent could not complete the task: {exc or type(exc).__name__}"
            await publish(Event(type="task.failed", task_id=task_id, payload={"error": task.error, "snapshot": snapshot(task)}))
            logger.error("[%s] Windows desktop task failed: %s", task_id, task.error)
            return
        repair_note = "The local model could not safely prepare a corrected action."
        repaired = None
        if task.repair_attempts == 0:
            try:
                repaired, repair_note = await asyncio.wait_for(
                    LocalOrchestrator().repair_tool_proposal(task.prompt, task.tool_proposal, str(exc)), timeout=30,
                )
            except (TimeoutError, WorkerError, ValueError, TypeError) as repair_exc:
                repair_note = f"Local diagnosis was unavailable: {repair_exc}"
        if repaired:
            try:
                corrected = ToolProposal.model_validate(repaired)
                spec = next((item for item in local_tool_catalog() if item["name"] == corrected.tool), None)
                if spec is not None and requires_approval(corrected):
                    task.tool_proposal = corrected.model_dump()
                    task.repair_attempts += 1
                    task.repair_note = f"{repair_note} Review the corrected action; it has not been run."
                    task.error = None
                    task.status = "awaiting_approval"
                    task.approval_required = True
                    await publish(Event(type="task.awaiting_approval", task_id=task_id, payload={"repair_note": task.repair_note, "tool_proposal": task.tool_proposal, "snapshot": snapshot(task)}))
                    return
            except (ValueError, TypeError, StopIteration):
                repair_note = "The model's correction did not match a registered approval-gated tool."
        task.status = "failed"
        task.error = f"The action failed: {exc or type(exc).__name__}. {repair_note}"
        await publish(Event(type="task.failed", task_id=task_id, payload={"error": task.error, "snapshot": snapshot(task)}))


@app.post("/api/tasks/{task_id}/approval", response_model=Task)
async def decide(task_id: str, body: ApprovalDecision):
    if task_id not in tasks:
        raise HTTPException(404, "Unknown task")
    task = tasks[task_id]
    if task.status != "awaiting_approval":
        raise HTTPException(409, "Task is not awaiting approval")
    if not body.approved:
        task.status = "rejected"
        await publish(Event(type="task.rejected", task_id=task_id))
        return task
    if task.tool_proposal:
        task.status = "running"
        task.approval_required = False
        launch_job(task_id, execute_approved_tool(task_id))
        return task
    task.approval_required = False
    task.status = "queued"
    launch_job(task_id, execute(task_id))
    return task


@app.websocket("/ws/tasks/{task_id}")
async def task_events(websocket: WebSocket, task_id: str):
    await websocket.accept()
    if task_id not in tasks:
        await websocket.close(code=1008)
        return
    queue: asyncio.Queue[str] = asyncio.Queue()
    subscribers[task_id].add(queue)
    try:
        await websocket.send_text(json.dumps({"type": "task.snapshot", "task_id": task_id, "payload": tasks[task_id].model_dump(mode="json")}))
        while True:
            await websocket.send_text(await queue.get())
    except WebSocketDisconnect:
        pass
    finally:
        subscribers[task_id].discard(queue)

