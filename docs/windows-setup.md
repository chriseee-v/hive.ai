# Windows setup

## Verified in the development environment

- Codex CLI: `0.167.0-alpha.3.2`
- Codex authentication: `codex login status` reported `Logged in using ChatGPT`
- Node.js: `v24.21.0`
- Docker: not installed
- WSL: installed but inaccessible to this session (`E_ACCESSDENIED`)

## Recommended setup

1. Install Docker Desktop with WSL2 integration enabled, or use native PostgreSQL/Redis for development.
2. If WSL2 is used, install a current Ubuntu distribution and verify `wsl --status` and `wsl -l -v` from an elevated PowerShell when required by Windows policy.
3. Install the official Codex CLI and run `codex login`; select the ChatGPT sign-in option. Do not copy or paste Codex session tokens into this application.
4. Run the backend and frontend natively for the first milestone. Start `docker compose up -d` only when Docker Desktop is available.
5. Keep services bound to localhost. Do not expose the API to the LAN until authentication and TLS are implemented.

## Plan and usage boundary

Codex CLI can use a ChatGPT account sign-in. The available usage is governed by the account/plan and may be shared across supported clients. The application should treat plan-limit responses as a user-visible stop condition and direct the user to ChatGPT usage settings. No paid API or API key is required for the demo worker, and no API key is requested by the Codex adapter.

