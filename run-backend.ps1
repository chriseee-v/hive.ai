$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PSScriptRoot).Path
$envFile = Join-Path $root '.env'
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $key = $Matches[1]; $value = $Matches[2].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}
$env:COMMAND_CENTRE_PROJECT_ROOT = $root
$env:COMMAND_CENTRE_OLLAMA_ENABLED = if ($env:COMMAND_CENTRE_OLLAMA_ENABLED) { $env:COMMAND_CENTRE_OLLAMA_ENABLED } else { 'true' }
$env:COMMAND_CENTRE_OLLAMA_MODEL = if ($env:COMMAND_CENTRE_OLLAMA_MODEL) { $env:COMMAND_CENTRE_OLLAMA_MODEL } else { 'qwen3.5:4b' }
$env:COMMAND_CENTRE_PROXY_ENABLED = if ($env:COMMAND_CENTRE_PROXY_ENABLED) { $env:COMMAND_CENTRE_PROXY_ENABLED } else { 'true' }
$env:COMMAND_CENTRE_PROXY_URL = if ($env:COMMAND_CENTRE_PROXY_URL) { $env:COMMAND_CENTRE_PROXY_URL } else { 'http://127.0.0.1:8317/v1' }
$env:COMMAND_CENTRE_PROXY_MODEL = if ($env:COMMAND_CENTRE_PROXY_MODEL) { $env:COMMAND_CENTRE_PROXY_MODEL } else { 'gpt-5.6-luna' }
$env:COMMAND_CENTRE_WINDOWS_MCP_ENABLED = if ($env:COMMAND_CENTRE_WINDOWS_MCP_ENABLED) { $env:COMMAND_CENTRE_WINDOWS_MCP_ENABLED } else { 'true' }
$env:COMMAND_CENTRE_WINDOWS_USE_ENABLED = if ($env:COMMAND_CENTRE_WINDOWS_USE_ENABLED) { $env:COMMAND_CENTRE_WINDOWS_USE_ENABLED } else { 'true' }
$env:COMMAND_CENTRE_WINDOWS_AUTO_APPROVE = if ($env:COMMAND_CENTRE_WINDOWS_AUTO_APPROVE) { $env:COMMAND_CENTRE_WINDOWS_AUTO_APPROVE } else { $env:COMMAND_CENTRE_WINDOWS_MCP_AUTO_APPROVE }
$env:LITELLM_LOCAL_MODEL_COST_MAP = if ($env:LITELLM_LOCAL_MODEL_COST_MAP) { $env:LITELLM_LOCAL_MODEL_COST_MAP } else { 'true' }
if ($env:COMMAND_CENTRE_PROXY_API_KEY -eq $null -and $env:CLIENT_KEY) { $env:COMMAND_CENTRE_PROXY_API_KEY = $env:CLIENT_KEY }
if ($env:COMMAND_CENTRE_WINDOWS_MCP_COMMAND) {
    $mcpPath = $env:COMMAND_CENTRE_WINDOWS_MCP_COMMAND.Trim().Trim('"').Trim("'")
    if (Test-Path -LiteralPath $mcpPath) {
        $mcpFullPath = (Get-Item -LiteralPath $mcpPath).FullName
        $env:Path = "$(Split-Path -Parent $mcpFullPath);$env:Path"
        $env:COMMAND_CENTRE_WINDOWS_MCP_COMMAND = 'uvx.exe'
    }
}
$uvxCommand = Get-Command uvx.exe -ErrorAction SilentlyContinue
if (-not $uvxCommand) { $uvxCommand = Get-Command uvx -ErrorAction SilentlyContinue }
if ($uvxCommand) {
    $env:Path = "$(Split-Path -Parent $uvxCommand.Source);$env:Path"
    $env:COMMAND_CENTRE_WINDOWS_MCP_COMMAND = $uvxCommand.Source
}
$apiPort = if ($env:COMMAND_CENTRE_API_PORT) { $env:COMMAND_CENTRE_API_PORT } else { '8001' }
$apiHost = if ($env:COMMAND_CENTRE_API_HOST) { $env:COMMAND_CENTRE_API_HOST } else { '0.0.0.0' }
Write-Host "AI Command Centre backend → http://$apiHost`:$apiPort" -ForegroundColor Cyan
Write-Host 'Windows-Use is the primary local desktop agent; manual approval is disabled by .env.' -ForegroundColor DarkGray
Set-Location (Join-Path $root 'backend')
& (Join-Path $root 'backend\.venv\Scripts\python.exe') -m uvicorn app.main:app --host $apiHost --port $apiPort
