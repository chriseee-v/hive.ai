$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PSScriptRoot).Path
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw "Backend virtual environment not found: $python"
}

Write-Host '[1/3] Installing the Windows-Use package and desktop runtime...' -ForegroundColor Cyan
& $python -m pip install --no-deps windows-use==0.8.1 pydantic-settings==2.12.0 jinja2==3.1.6 h2==4.3.0 importlib-metadata==8.7.0 openai==3.51.0 ollama==0.6.3 comtypes==1.4.16 pywin32==311 pillow==12.0.0 psutil==7.1.3 python-dotenv==1.2.1 rich==14.2.0

# Windows-Use eagerly imports every optional cloud SDK. Keep startup local-first
# by replacing that import hub with the shared protocols; the selected provider
# is still imported by backend/app/windows_use_agent.py.
$site = Join-Path (Split-Path (Split-Path $python -Parent) -Parent) 'Lib\site-packages'
$providerInit = Join-Path $site 'windows_use\providers\__init__.py'
@'
"""Lightweight provider hub for the Command Centre runtime."""
from windows_use.providers.base import BaseChatLLM, BaseSTT, BaseTTS
from windows_use.providers.events import LLMEvent, LLMStreamEvent, Thinking, ToolCall
from windows_use.providers.views import Metadata, TokenUsage

__all__ = ["BaseChatLLM", "BaseSTT", "BaseTTS", "TokenUsage", "Metadata", "Thinking", "LLMEvent", "LLMStreamEvent", "ToolCall"]
'@ | Set-Content -LiteralPath $providerInit -Encoding utf8

Write-Host '[2/3] Creating Windows-Use local memory storage...' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE '.windows-use\memory') | Out-Null

Write-Host '[3/3] Verifying the adapter...' -ForegroundColor Cyan
$env:LITELLM_LOCAL_MODEL_COST_MAP = 'true'
& $python -c "from windows_use import Agent; from windows_use.providers.openai import ChatOpenAI; print('Windows-Use import OK')"
if ($LASTEXITCODE -ne 0) { throw 'Windows-Use verification failed.' }
Write-Host 'Windows-Use is ready. Restart run-backend.ps1 before testing a desktop task.' -ForegroundColor Green
