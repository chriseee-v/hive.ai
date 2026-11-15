# Implementation status

## Implemented

- Local FastAPI service and Pydantic models.
- Agent registry with start/stop lifecycle controls.
- Task creation, status, approval/rejection, and task detail APIs.
- WebSocket task snapshots and progress events.
- Deterministic local demo worker.
- Codex CLI adapter with explicit environment-variable opt-in and no credential handling.
- Ollama adapter boundary with safe default disabled state.
- Next.js dashboard, responsive layout, task console, approval UI, and push-to-talk browser input.
- Compose services for PostgreSQL and Redis.

## Planned integrations

- SQLModel/Alembic persistence and Redis-backed event fan-out.
- Real worker queue and cancellation/retry semantics.
- Per-user authentication and encrypted local token storage if a supported account integration is added.
- A complete Ollama HTTP adapter and hardware-aware model settings.
- Voice transcription beyond the browser's built-in Web Speech API.
- Audit log, filesystem/network policy enforcement, and signed approval records.

## Local tool boundary

The backend now publishes a tool catalog at `GET /api/tools`. The listed tools are intentionally proposals only and are not executable yet. Shell, files, Docker, screenshots, reminders, local agent spawning, and recycle-bin deletion require a Windows-side executor, scoped permissions, per-action approval records, and result streaming before they can be enabled. The cloud model currently returns text; it cannot directly operate this machine.

The boundary is intentional: a ChatGPT Go subscription is used only through supported Codex account authentication where available. This repository does not turn the subscription into a general API credential and does not expose Codex session files.

