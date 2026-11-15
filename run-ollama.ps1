$ErrorActionPreference = 'Stop'
$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollama) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
        (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
    )
    $ollamaPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
} else { $ollamaPath = $ollama.Source }
if (-not $ollamaPath) { throw 'Ollama was not found. Install Ollama for Windows first.' }
try { Invoke-RestMethod http://127.0.0.1:11434/api/tags -TimeoutSec 2 | Out-Null; Write-Host 'Ollama is already running on port 11434.' -ForegroundColor Green; exit 0 } catch {}
Write-Host "Starting Ollama from $ollamaPath" -ForegroundColor Green
& $ollamaPath serve
