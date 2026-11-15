#!/usr/bin/env bash
# Start the local AI Command Centre from Git Bash on Windows.
# Logs are written under ./logs and secret values are never printed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
TOOLS_DIR="${COMMAND_CENTRE_TOOLS_DIR:-/c/tools/CLIProxyAPI}"
SESSION="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$ROOT/logs/$SESSION"
PID_DIR="$ROOT/.run"
mkdir -p "$LOG_DIR" "$PID_DIR"

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_GREEN=''; C_RED=''; C_YELLOW=''; C_CYAN=''; C_DIM=''
fi

say() { printf '%s[%s]%s %s\n' "$C_CYAN" "$(date '+%H:%M:%S')" "$C_RESET" "$*"; logline "$*" >> "$LOG_DIR/launcher.log"; }
ok() { printf '%s[  OK  ]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; logline "OK: $*" >> "$LOG_DIR/launcher.log"; }
warn() { printf '%s[ WARN ]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; logline "WARN: $*" >> "$LOG_DIR/launcher.log"; }
fail() { printf '%s[ FAIL ]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; logline "FAIL: $*" >> "$LOG_DIR/launcher.log"; }
logline() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

cleanup() {
  say "Stopping this session's services…"
  for name in frontend backend ollama proxy; do
    file="$PID_DIR/$SESSION-$name.pid"
    if [[ -f "$file" ]]; then
      pid="$(<"$file")"
      if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
      rm -f "$file"
    fi
  done
  say "Logs kept at: $LOG_DIR"
}
trap cleanup INT TERM EXIT

for required in "$BACKEND/.venv/Scripts/python.exe" "$FRONTEND/node_modules/.bin/next" "$FRONTEND/package.json"; do
  if [[ ! -e "$required" ]]; then
    fail "Missing $required"
    fail "Install the backend venv and frontend dependencies first (see README.md)."
    exit 1
  fi
done

# Read simple KEY=value entries without sourcing/evaluating shell code.
if [[ -f "$ROOT/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
      value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
      export "$key=$value"
    fi
  done < "$ROOT/.env"
fi

if [[ -n "${CLIENT_KEY:-}" && -z "${COMMAND_CENTRE_PROXY_API_KEY:-}" ]]; then
  export COMMAND_CENTRE_PROXY_API_KEY="$CLIENT_KEY"
fi
export COMMAND_CENTRE_PROXY_ENABLED="${COMMAND_CENTRE_PROXY_ENABLED:-true}"
export COMMAND_CENTRE_PROXY_URL="${COMMAND_CENTRE_PROXY_URL:-http://127.0.0.1:8317/v1}"
export COMMAND_CENTRE_PROXY_MODEL="${COMMAND_CENTRE_PROXY_MODEL:-gpt-5.6-luna}"
export COMMAND_CENTRE_OLLAMA_ENABLED="${COMMAND_CENTRE_OLLAMA_ENABLED:-true}"
export COMMAND_CENTRE_OLLAMA_MODEL="${COMMAND_CENTRE_OLLAMA_MODEL:-qwen3.5:4b}"
export COMMAND_CENTRE_WINDOWS_MCP_ENABLED="${COMMAND_CENTRE_WINDOWS_MCP_ENABLED:-false}"
export COMMAND_CENTRE_API_PORT="${COMMAND_CENTRE_API_PORT:-8001}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:${COMMAND_CENTRE_API_PORT}}"
if command -v cygpath >/dev/null 2>&1; then
  export COMMAND_CENTRE_PROJECT_ROOT="$(cygpath -w "$ROOT")"
else
  export COMMAND_CENTRE_PROJECT_ROOT="$ROOT"
fi

start_service() {
  local name="$1"; shift
  local logfile="$LOG_DIR/$name.log"
  (cd "$ROOT" && "$@") >>"$logfile" 2>&1 &
  local pid=$!
  printf '%s' "$pid" > "$PID_DIR/$SESSION-$name.pid"
  logline "Started $name (pid $pid)" >> "$logfile"
  ok "$name started; output → logs/$SESSION/$name.log"
}

http_ready() {
  local url="$1"
  curl.exe -fsS --max-time 2 "$url" >/dev/null 2>&1
}

say "AI Command Centre startup — session $SESSION"
say "Project: $ROOT"
say "Writing all service output to logs/$SESSION/"
if [[ "$COMMAND_CENTRE_WINDOWS_MCP_ENABLED" == "true" ]]; then
  ok "Windows-MCP desktop tools enabled (approval-gated)"
else
  warn "Windows-MCP not set up yet; desktop tools are unavailable"
fi

# Ollama is installed as a native Windows background app; start it only if its API is down.
if ! http_ready "http://127.0.0.1:11434/api/tags"; then
  OLLAMA_CMD="$(command -v ollama.exe || command -v ollama || true)"
  if [[ -z "$OLLAMA_CMD" ]]; then
    for candidate in "${LOCALAPPDATA:-}/Programs/Ollama/ollama.exe" "${USERPROFILE:-}/AppData/Local/Programs/Ollama/ollama.exe" "/c/Program Files/Ollama/ollama.exe" "/c/Users/$USER/AppData/Local/Programs/Ollama/ollama.exe"; do
      if [[ -n "$candidate" && -x "$candidate" ]]; then OLLAMA_CMD="$candidate"; break; fi
    done
  fi
  if [[ -n "$OLLAMA_CMD" ]]; then
    "$OLLAMA_CMD" serve >>"$LOG_DIR/ollama.log" 2>&1 &
    printf '%s' "$!" > "$PID_DIR/$SESSION-ollama.pid"
    ok "Ollama starting (model: $COMMAND_CENTRE_OLLAMA_MODEL)"
  else
    warn "Ollama is not installed/found; local model orchestration is unavailable. Install Ollama for Windows, then rerun this launcher."
  fi
else
  ok "Ollama already responds on port 11434"
fi

# CLIProxyAPI needs an existing user config and successful Codex OAuth login.
PROXY_EXE="$TOOLS_DIR/cli-proxy-api.exe"
PROXY_CONFIG="$TOOLS_DIR/config.yaml"
if ! http_ready "http://127.0.0.1:8317/v1/models"; then
  if [[ -x "$PROXY_EXE" && -f "$PROXY_CONFIG" ]]; then
    (cd "$TOOLS_DIR" && "$PROXY_EXE" -config "$PROXY_CONFIG") >>"$LOG_DIR/proxy.log" 2>&1 &
    printf '%s' "$!" > "$PID_DIR/$SESSION-proxy.pid"
    ok "CLIProxyAPI starting on port 8317"
  else
    warn "CLIProxyAPI files not found at $TOOLS_DIR; cloud routing will be unavailable. Set COMMAND_CENTRE_TOOLS_DIR if installed elsewhere."
  fi
else
  ok "CLIProxyAPI already responds on port 8317"
fi

start_service backend bash -lc "cd '$BACKEND' && exec ./\.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port '$COMMAND_CENTRE_API_PORT'"
start_service frontend bash -lc "cd '$FRONTEND' && exec npm run dev -- --hostname 127.0.0.1"

say "Waiting for the API and dashboard"
spinner='|/-\\'; ready=0
for ((i=0; i<60; i++)); do
  if http_ready "http://127.0.0.1:$COMMAND_CENTRE_API_PORT/health" && http_ready "http://127.0.0.1:3000"; then ready=1; break; fi
  printf '\r%s[%s]%s Starting services %s' "$C_CYAN" "${spinner:i%4:1}" "$C_RESET" "${spinner:i%4:1}"
  sleep 1
done
printf '\n'
if (( ready )); then
  ok "API ready: http://127.0.0.1:$COMMAND_CENTRE_API_PORT"
  ok "Dashboard ready: http://localhost:3000"
  if command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "http://localhost:3000" >/dev/null 2>&1 || true; fi
else
  fail "Startup timed out. Check the service logs under logs/$SESSION/"
fi

printf '\n%sLive logs%s  (Ctrl+C stops services started by this script; logs are retained)\n' "$C_DIM" "$C_RESET"
# Tag each component and color its stream. Secrets are not echoed by the launcher.
for name in backend frontend ollama proxy; do touch "$LOG_DIR/$name.log"; done
tail -n 0 -F "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log" "$LOG_DIR/ollama.log" "$LOG_DIR/proxy.log" 2>/dev/null |
  awk '
    /backend\.log/ {tag="API"; color="\033[36m"; next}
    /frontend\.log/ {tag="WEB"; color="\033[35m"; next}
    /ollama\.log/ {tag="LOCAL"; color="\033[32m"; next}
    /proxy\.log/ {tag="CLOUD"; color="\033[33m"; next}
    { if (tag == "") tag="LOG"; printf "%s[%s]%s %s\n", color, tag, "\033[0m", $0; fflush() }
  '
