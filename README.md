# AI Command Centre — Milestone 1

Local-first command centre for a Windows laptop (16 GB RAM) with a Next.js PWA dashboard, FastAPI task service, WebSocket updates, agent lifecycle controls, approval gates, and optional local inference.

## What works now

- FastAPI backend with health, agent registry, lifecycle, task creation, task detail, and approval endpoints.
- WebSocket endpoint for task events.
- Local `demo` agent that completes tasks without an external model.
- Guarded Codex worker adapter. It can call the already-authenticated local `codex exec` only when explicitly enabled; it never reads or exposes credentials.
- Local Ollama orchestrator and worker using `qwen3.5:4b`, disabled until explicitly enabled.
- Next.js PWA dashboard for agent status, task submission, approvals, and live task events.
- Docker Compose definitions for PostgreSQL and Redis, with the backend designed to remain usable in in-memory mode.
- Push-to-talk browser voice input using the Web Speech API when the browser supports it.
- Tests for API behavior and approval boundaries.

## What is deliberately not implemented yet

- Durable persistence/migrations; PostgreSQL and Redis are reserved for the next milestone.
- Background worker queue and multi-process orchestration.
- General-purpose ChatGPT/Go API access. A ChatGPT subscription is not assumed to be an API key entitlement.
- Automatic voice transmission or always-on microphone capture.
- Production authentication, multi-user tenancy, remote exposure, or cloud deployment.

## Quick start (native Windows)

### One-command launcher (Git Bash)

In PowerShell, run the wrapper (it launches Git Bash directly, so WSL is not needed):

```powershell
cd C:\projects\chill.ai
.\start-command-centre.ps1
```

Or open Git Bash and run:

```bash
cd /c/projects/chill.ai
bash ./start-command-centre.sh
```

The launcher starts the API and dashboard, starts Ollama and CLIProxyAPI when their local services are not already reachable, checks startup, opens the dashboard, and streams colored, tagged logs. Session logs are saved in `logs/<timestamp>/`; press Ctrl+C to stop processes launched by that run. Existing services are detected and left running. CLIProxyAPI is expected at `C:\tools\CLIProxyAPI` with a completed `config.yaml` and OAuth login; override its folder with `COMMAND_CENTRE_TOOLS_DIR` if needed. Put `CLIENT_KEY=...` in the root `.env` or export `COMMAND_CENTRE_PROXY_API_KEY` in the shell. Secret values are not printed.

The script requires `backend/.venv/Scripts/python.exe`, `frontend/node_modules`, Node/npm, and Git Bash. Ollama and CLIProxyAPI may be absent; the launcher warns and the corresponding model route will be unavailable.

### Separate terminals

You can run each service independently from PowerShell:

```powershell
cd C:\projects\chill.ai
.\run-backend.ps1
```

In three additional terminals, run:

```powershell
cd C:\projects\chill.ai
.\run-frontend.ps1
```

```powershell
cd C:\projects\chill.ai
.\run-ollama.ps1
```

```powershell
cd C:\projects\chill.ai
.\run-cliproxyapi.ps1
```

The backend uses port `8001` by default and the dashboard points to it automatically. Set `COMMAND_CENTRE_API_PORT` in `.env` to choose another port. Windows-MCP is started by the backend on demand for each approved desktop task, so it does not need its own terminal.

### Windows desktop actions with Windows-Use

The primary desktop executor is now Windows-Use, a local Windows UI-automation agent. It uses the configured CLIProxyAPI/Codex-compatible endpoint by default, or Ollama if `COMMAND_CENTRE_WINDOWS_USE_PROVIDER="ollama"`. The project adapter is in `backend/app/windows_use_agent.py`; it streams the selected provider, model, step, and tool information into the backend log.

Install the runtime in the backend virtual environment, then restart the backend:

```powershell
cd C:\projects\chill.ai
& .\backend\.venv\Scripts\Activate.ps1
python -m pip install -r .\backend\requirements.txt
```

Windows-Use is a full desktop agent rather than an MCP server. It can control visible Windows applications and may modify the computer, so keep the Windows session unlocked while a task runs. The repository is [Windows-Use](https://github.com/Jeomon/Windows-Use). Its own documentation warns that it has no sandbox; use it only on a machine where those actions are acceptable.

The older Windows-MCP bridge remains available as a fallback only:

```powershell
cd C:\projects\chill.ai
.\setup-windows-mcp.ps1
```

The setup installs the free `uv` runner for your Windows user, prepares Windows-MCP with its required Python 3.14 runtime, and updates only the Windows-MCP settings in `.env`. Then restart the Command Centre. You do not need WSL or Docker for this component.

The backend starts Windows-MCP over local `stdio` only when Windows-Use is disabled. `COMMAND_CENTRE_WINDOWS_MCP_HEADLESS=true` affects only that fallback bridge.

To disable the fallback bridge, set `COMMAND_CENTRE_WINDOWS_MCP_ENABLED=false` in `.env` and restart. Ollama can remain the small local router model, but the recommended Windows-Use provider is `proxy`: small Ollama models may emit malformed structured tool calls, while the CLIProxyAPI provider is more reliable for desktop execution. The proxy runs locally and does not expose the client key to the browser.

Luna is not required for Windows-Use. To use a separate provider, configure one of these OpenAI-compatible backends in this project's `.env`:

```env
COMMAND_CENTRE_WINDOWS_USE_PROVIDER="openrouter"
OPEN_ROUTER_API_KEY="<your-existing-openrouter-key>"
COMMAND_CENTRE_WINDOWS_USE_MODEL="nvidia/nemotron-3.5-lightning:free"
```

or:

```env
COMMAND_CENTRE_WINDOWS_USE_PROVIDER="openrouter"
OPENROUTER_API_KEY="<your-existing-openrouter-key>"
COMMAND_CENTRE_WINDOWS_USE_MODEL="<your-existing-openrouter-model>"
```

The backend reads these values server-side only. It never sends them to the dashboard.

### Persistent agent memory with Cognee

The Command Centre now keeps a local, persistent memory for confirmed outcomes and preferences. It uses the SQLite index in `.run/command-centre-memory.sqlite3` for immediate lookups, and queues Cognee enrichment in the background for semantic/graph recall. This keeps desktop actions responsive even when Cognee is doing first-run initialization. Cognee is installed in the backend virtual environment and is configured without a paid API requirement.

Check memory status:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/api/orchestrator/status | ConvertTo-Json -Depth 6
```

Test it directly:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8001/api/memory/remember -ContentType "application/json" -Body '{"content":"Airbnb opens in Brave","kind":"preference","verified":true}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8001/api/memory/recall -ContentType "application/json" -Body '{"query":"open Airbnb"}'
```

Only successful task outcomes are automatically written as verified memory. The memory service never stores provider credentials.

Desktop approval is intentionally disabled in this project configuration (`COMMAND_CENTRE_WINDOWS_AUTO_APPROVE="true"`) so tasks start immediately after routing. This is a significant safety trade-off: a Windows desktop request can run without a dashboard confirmation. Set it to `false` and restart if you want the approval gate back.

Backend:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Dashboard:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The dashboard expects the API at `http://127.0.0.1:8001` when using the separate scripts.

Run backend tests:

```powershell
cd backend
pip install -r requirements-dev.txt
pytest -q
```

## Local orchestrator and model

The default self-hosted model is Ollama `qwen3.5:4b`. Ollama lists this variant at roughly 3.3–4.0 GB and it is a good balance for a 16 GB laptop. The orchestrator classifies tasks as `local`, `cloud`, or `both`: local uses Ollama, cloud uses the approval-gated CLIProxyAPI/Codex endpoint, and both runs local analysis before approved cloud execution.

Install Ollama for Windows, then run:

```powershell
ollama pull qwen3.5:4b
$env:COMMAND_CENTRE_OLLAMA_ENABLED = "true"
$env:COMMAND_CENTRE_OLLAMA_MODEL = "qwen3.5:4b"
$env:COMMAND_CENTRE_PROXY_ENABLED = "true"
$env:COMMAND_CENTRE_PROXY_URL = "http://127.0.0.1:8317/v1"
$env:COMMAND_CENTRE_PROXY_API_KEY = "your-local-client-key"
$env:COMMAND_CENTRE_PROXY_MODEL = "gpt-5.6-luna"
```

The dashboard now submits through `/api/orchestrate`. If Ollama is unavailable, a deterministic fallback router keeps the system usable, but routed Ollama tasks will report the local service error until Ollama is started.

## Codex worker adapter

The adapter is opt-in:

```powershell
$env:COMMAND_CENTRE_CODEX_ENABLED = "true"
uvicorn app.main:app --reload --port 8001
```

It invokes `codex exec` as a local subprocess and passes only the task prompt on stdin. It does not inspect `%USERPROFILE%\\.codex\\auth.json`, request API keys, or forward credentials to the browser or backend API. Check the local login state with `codex login status`.

The official supported flow is to sign in to Codex CLI with ChatGPT. Usage limits remain account/plan controlled; the application must surface limit errors and send the user to ChatGPT usage settings rather than attempting a workaround.

## Windows notes

- Native PowerShell is supported for this milestone.
- Prefer WSL2 + Docker Desktop for the PostgreSQL/Redis services if Docker Desktop is your normal development setup. This session could not access WSL and Docker is not installed, so Compose was not started here.
- Keep the API bound to localhost until authentication and transport security are added.
- Ollama is optional and should use `qwen3.5:4b` on a 16 GB machine; it is disabled by default.

## Architecture

```text
Next.js PWA ──HTTP/WS──> FastAPI API ──> Agent registry/lifecycle
                              │                 ├─ demo worker
                              │                 ├─ guarded Codex CLI worker
                              │                 └─ optional Ollama worker
                              ├─ approval policy
                              ├─ in-memory event broker
                              └─ PostgreSQL/Redis (Compose, next milestone)
```

See `docs/windows-setup.md` and `docs/implementation-status.md` for setup and boundary details.

#   h i v e . a i  
 #   h i v e . a i  
 