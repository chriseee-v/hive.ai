import asyncio
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
from collections.abc import AsyncIterator
from typing import Any

from .errors import WorkerError
from .orchestrator import OllamaClient, ProxyClient


# ── Handy Offline STT Integration ──
# Handy is a free, open-source speech-to-text application that works completely offline.
# It uses Whisper or Parakeet V3 models with Silero VAD for silence filtering.
# https://github.com/cjpais/Handy

class HandySTT:
    """Integration with Handy offline speech-to-text application.
    
    Handy provides offline transcription using Whisper or Parakeet V3 models.
    This class handles the CLI integration and status checking.
    """
    
    def __init__(self) -> None:
        self.handy_cli_available = self._check_handy_cli()
        self.transcription_mode = "whisper"  # or "parakeet"
        self.model_size = "medium"  # small, medium, turbo, large
        self.is_listening = False
        self.last_transcription = ""
    
    def _check_handy_cli(self) -> bool:
        """Check if Handy CLI is available."""
        try:
            result = subprocess.run(
                ["handy", "--version"], 
                capture_output=True, text=True, timeout=5
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    def get_status(self) -> dict[str, Any]:
        """Get Handy STT status."""
        return {
            "available": self.handy_cli_available,
            "mode": self.transcription_mode,
            "model": self.model_size,
            "listening": self.is_listening,
            "last_transcription": self.last_transcription[:100] if self.last_transcription else "",
        }
    
    async def transcribe_from_handy(self, audio_path: str) -> str:
        """Transcribe audio using Handy CLI.
        
        Args:
            audio_path: Path to the audio file to transcribe
            
        Returns:
            Transcribed text
        """
        if not self.handy_cli_available:
            raise WorkerError("Handy CLI is not available. Install Handy first.")
        
        try:
            result = subprocess.run(
                ["handy", "transcribe", audio_path, 
                 "--model", self.model_size,
                 "--mode", self.transcription_mode],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0:
                self.last_transcription = result.stdout.strip()
                return self.last_transcription
            else:
                raise WorkerError(f"Handy transcription failed: {result.stderr}")
        except subprocess.TimeoutExpired:
            raise WorkerError("Handy transcription timed out")
    
    def start_listening(self) -> dict[str, Any]:
        """Start listening via Handy."""
        self.is_listening = True
        self.last_transcription = ""
        return self.get_status()
    
    def stop_listening(self) -> dict[str, Any]:
        """Stop listening via Handy."""
        self.is_listening = False
        return self.get_status()


handy_stt = HandySTT()


class DemoWorker:
    async def run(self, prompt: str) -> AsyncIterator[str]:
        yield "Demo worker accepted the task."
        await asyncio.sleep(0)
        yield f"Local milestone response: {prompt}"


class CodexWorker:
    """Opt-in adapter around the user's local Codex CLI session.

    The adapter intentionally never reads auth files or accepts credentials from the API.
    """

    def __init__(self) -> None:
        self.enabled = os.getenv("COMMAND_CENTRE_CODEX_ENABLED", "false").lower() == "true"
        self._process: subprocess | None = None
        self._process_started_at: float | None = None

    async def run(self, prompt: str) -> AsyncIterator[str]:
        if not self.enabled:
            raise WorkerError("Codex worker is disabled; set COMMAND_CENTRE_CODEX_ENABLED=true")
        if shutil.which("codex") is None:
            raise WorkerError("Codex CLI is not installed or not available on PATH")
        self._process = await asyncio.create_subprocess_exec(
            "codex", "exec", "--skip-git-repo-check", "-",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._process_started_at = asyncio.get_event_loop().time()
        stdout, stderr = await self._process.communicate(prompt.encode("utf-8"))
        if self._process.returncode != 0:
            detail = stderr.decode("utf-8", errors="replace").strip()[:500]
            raise WorkerError(detail or f"codex exec exited with {self._process.returncode}")
        yield stdout.decode("utf-8", errors="replace").strip()

    def is_running(self) -> bool:
        """Check if a Codex process is currently running."""
        if self._process is None:
            return False
        # Process is running if it hasn't terminated yet
        return self._process.returncode is None

    def get_process_info(self) -> dict[str, Any]:
        """Get information about the Codex process."""
        if self._process is None:
            return {"running": False, "started_at": None, "elapsed": None}
        elapsed = None
        if self._process_started_at is not None:
            import time
            elapsed = time.time() - self._process_started_at
        return {
            "running": self.is_running(),
            "started_at": self._process_started_at,
            "elapsed_seconds": round(elapsed, 2) if elapsed else None,
        }


class OllamaWorker:
    def __init__(self) -> None:
        self.enabled = os.getenv("COMMAND_CENTRE_OLLAMA_ENABLED", "true").lower() == "true"
        self.model = os.getenv("COMMAND_CENTRE_OLLAMA_MODEL", "qwen3.5:4b")

    async def run(self, prompt: str) -> AsyncIterator[str]:
        if not self.enabled:
            raise WorkerError("Ollama is disabled")
        yield await OllamaClient().chat([
            {"role": "system", "content": "You are the user's direct local chat assistant. Reply naturally in clear plain text. Do not return JSON unless the user explicitly asks for JSON."},
            {"role": "user", "content": prompt},
        ], num_predict=320, json_mode=False)


class ProxyWorker:
    """Approval-gated worker using the user's local CLIProxyAPI endpoint."""

    def __init__(self) -> None:
        self.enabled = os.getenv("COMMAND_CENTRE_PROXY_ENABLED", "true").lower() == "true"

    async def run(self, prompt: str) -> AsyncIterator[str]:
        if not self.enabled:
            raise WorkerError("CLIProxyAPI worker is disabled; set COMMAND_CENTRE_PROXY_ENABLED=true")
        yield await ProxyClient().responses(prompt)


class LangSearchWorker:
    """Free web-search adapter. It never handles Windows desktop actions."""

    endpoint = "https://api.langsearch.com/v1/web-search"

    def __init__(self) -> None:
        self.api_key = os.getenv("LANGSEARCH_API_KEY", "").strip()

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    async def run(self, prompt: str) -> AsyncIterator[str]:
        if not self.api_key:
            raise WorkerError("LangSearch is not configured; add LANGSEARCH_API_KEY to .env")

        payload = json.dumps({
            "query": prompt,
            "count": 5,
            "contents": {"text": {"max_characters": 3000}},
        }).encode("utf-8")

        def request() -> str:
            try:
                req = urllib.request.Request(
                    self.endpoint,
                    data=payload,
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=30) as response:
                    body = json.loads(response.read().decode("utf-8"))
                if str(body.get("code", "200")) != "200":
                    raise WorkerError(f"LangSearch rejected the query: {body.get('message', 'unknown error')}")
                values = body.get("data", {}).get("webPages", {}).get("value", [])
                if not values:
                    return "No web results were found."
                lines = ["Web results from LangSearch:"]
                for item in values[:5]:
                    title = str(item.get("name", "Untitled")).strip()
                    url = str(item.get("url", "")).strip()
                    text = str(item.get("text") or item.get("snippet") or "").strip()
                    lines.append(f"\n{title}\n{url}\n{text[:3000]}")
                return "\n".join(lines)
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")[:500]
                raise WorkerError(f"LangSearch returned HTTP {exc.code}: {detail}") from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                raise WorkerError(f"LangSearch is unavailable: {exc}") from exc

        yield await asyncio.to_thread(request)


class HybridWorker:
    def __init__(self) -> None:
        self.local = OllamaWorker()
        self.cloud = ProxyWorker()

    async def run(self, prompt: str) -> AsyncIterator[str]:
        local_parts: list[str] = []
        async for chunk in self.local.run(prompt):
            local_parts.append(chunk)
            yield f"Local analysis:\n{chunk}"
        local_analysis = "\n".join(local_parts)
        cloud_prompt = f"Complete the approved task using this local analysis as context.\n\nTask:\n{prompt}\n\nLocal analysis:\n{local_analysis}"
        async for chunk in self.cloud.run(cloud_prompt):
            yield f"Cloud execution:\n{chunk}"

