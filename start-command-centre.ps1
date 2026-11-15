$ErrorActionPreference = 'Stop'

$root = (Resolve-Path $PSScriptRoot).Path
$runDir = Join-Path $root '.run'
$logRoot = Join-Path $root 'logs'
$session = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $logRoot $session
try {
    New-Item -ItemType Directory -Force -Path $runDir, $logDir -ErrorAction Stop | Out-Null
} catch {
    # Some Windows workspaces have an inherited read-only ACL on ./logs.
    # Keep the launcher usable and retain all output under the writable run dir.
    $logRoot = Join-Path $runDir 'logs'
    $logDir = Join-Path $logRoot $session
    New-Item -ItemType Directory -Force -Path $runDir, $logDir -ErrorAction Stop | Out-Null
    Write-Host ('Project logs directory is not writable; using {0}' -f $logDir) -ForegroundColor Yellow
}

function Import-ProjectEnv {
    $envFile = Join-Path $root '.env'
    if (-not (Test-Path -LiteralPath $envFile)) { return }
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $key = $Matches[1]
            $value = $Matches[2].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

function Write-Status([string]$message, [ConsoleColor]$color = [ConsoleColor]::Cyan) {
    Write-Host ('[{0}] {1}' -f (Get-Date -Format HH:mm:ss), $message) -ForegroundColor $color
    Add-Content -LiteralPath (Join-Path $logDir 'launcher.log') -Value ('[{0}] {1}' -f (Get-Date -Format s), $message)
}

function Find-FreePort([int]$start) {
    for ($port = $start; $port -lt ($start + 100); $port++) {
        # Uvicorn binds 0.0.0.0, so probe the wildcard address too; probing only
        # loopback can report a port as free when the wildcard is already held.
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
        try { $listener.Start(); $listener.Stop(); return $port } catch { $listener.Stop() }
    }
    throw ('No free port found starting at {0}' -f $start)
}

function Test-PortOpen([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { $client.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $client.Dispose() }
}

function Start-LoggedProcess([string]$name, [string]$file, [string[]]$arguments, [string]$workingDirectory, [string]$pidSuffix = $name) {
    $stdout = Join-Path $logDir ('{0}.out.log' -f $name)
    $stderr = Join-Path $logDir ('{0}.err.log' -f $name)
    $process = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $workingDirectory -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Set-Content -LiteralPath (Join-Path $runDir ('{0}-{1}.pid' -f $session, $pidSuffix)) -Value $process.Id
    Write-Status ('{0} started (PID {1}); logs -> {2}' -f $name, $process.Id, $logDir) Green
    return $process
}

Import-ProjectEnv
$npmGlobal = Join-Path $env:APPDATA 'npm'
if (Test-Path -LiteralPath (Join-Path $npmGlobal 'opencode.cmd')) {
    # npm's per-user bin directory is sometimes absent from PATH in new terminals.
    $env:Path = '{0};{1}' -f $npmGlobal, $env:Path
    Write-Status ('OpenCode CLI found at {0}' -f $npmGlobal) Green
}
if (Test-Path -LiteralPath (Join-Path $root 'stop-command-centre.ps1')) {
    & (Join-Path $root 'stop-command-centre.ps1') | Out-Host
}

$env:COMMAND_CENTRE_PROJECT_ROOT = $root
$env:COMMAND_CENTRE_API_HOST = if ($env:COMMAND_CENTRE_API_HOST) { $env:COMMAND_CENTRE_API_HOST } else { '0.0.0.0' }
$apiPort = if ($env:COMMAND_CENTRE_API_PORT) { [int]$env:COMMAND_CENTRE_API_PORT } else { 8001 }
$frontPort = if ($env:COMMAND_CENTRE_FRONTEND_PORT) { [int]$env:COMMAND_CENTRE_FRONTEND_PORT } else { 3001 }
foreach ($requiredPort in @($apiPort, $frontPort)) {
    if (Test-PortOpen $requiredPort) {
        $owner = Get-NetTCPConnection -LocalPort $requiredPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
        if (-not $owner) { $owner = 'unknown' }
        throw ('Required port {0} is already in use by PID {1}. Stop that process, then rerun the launcher.' -f $requiredPort, $owner)
    }
}
$env:VITE_COMMAND_CENTRE_API_PORT = [string]$apiPort
$env:VITE_COMMAND_CENTRE_FRONTEND_PORT = [string]$frontPort
$env:VITE_COMMAND_CENTRE_FRONTEND_HOST = '0.0.0.0'

Write-Status ('AI Command Centre starting - session {0}' -f $session) Magenta
Write-Status ('Backend: http://{0}:{1}' -f $env:COMMAND_CENTRE_API_HOST, $apiPort)
Write-Status ('Dashboard port: {0}' -f $frontPort)

$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw ('Backend virtual environment not found: {0}' -f $python) }
$backendDirectory = Join-Path $root 'backend'
$backendArguments = @('-m', 'uvicorn', 'app.main:app', '--host', $env:COMMAND_CENTRE_API_HOST, '--port', [string]$apiPort)
Start-LoggedProcess 'backend' $python $backendArguments $backendDirectory | Out-Null

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw 'npm.cmd was not found on PATH.' }
Start-LoggedProcess 'frontend' $npm @('run', 'dev') (Join-Path $root 'frontend') | Out-Null

try { $ollamaReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2).StatusCode -eq 200 } catch { $ollamaReady = $false }
if (-not $ollamaReady) {
    $ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
    $ollamaPath = if ($ollama) { $ollama.Source } else { $null }
    if (-not $ollamaPath) {
        $standardOllamaPath = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
        if (Test-Path -LiteralPath $standardOllamaPath) { $ollamaPath = $standardOllamaPath }
    }
    if ($ollamaPath) {
        Write-Status ('Starting Ollama from {0}' -f $ollamaPath) Green
        Start-LoggedProcess 'ollama' $ollamaPath @('serve') $root 'ollama' | Out-Null
    } else {
        Write-Status 'Ollama not found; local inference may be unavailable.' Yellow
    }
} else { Write-Status 'Ollama already responds on port 11434.' Green }

$proxyReady = Test-PortOpen 8317
$toolsDir = if ($env:COMMAND_CENTRE_TOOLS_DIR) { $env:COMMAND_CENTRE_TOOLS_DIR } else { 'C:\tools\CLIProxyAPI' }
$proxyExe = Join-Path $toolsDir 'cli-proxy-api.exe'
$proxyConfig = Join-Path $toolsDir 'config.yaml'
if (-not $proxyReady -and (Test-Path -LiteralPath $proxyExe) -and (Test-Path -LiteralPath $proxyConfig)) {
    Start-LoggedProcess 'cliproxyapi' $proxyExe @('-config', $proxyConfig) $toolsDir 'proxy' | Out-Null
} elseif ($proxyReady) { Write-Status 'CLIProxyAPI already responds on port 8317.' Green } else { Write-Status ('CLIProxyAPI not found at {0}; cloud routing remains unavailable.' -f $toolsDir) Yellow }

$apiReady = $false
$healthUrl = 'http://127.0.0.1:{0}/health' -f $apiPort
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try { if ((Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2).StatusCode -eq 200) { $apiReady = $true; break } } catch {}
    Start-Sleep -Milliseconds 500
}
if ($apiReady) { Write-Status ('API ready: http://127.0.0.1:{0}' -f $apiPort) Green } else { Write-Status ('API did not become ready. Check {0}/backend.err.log' -f $logDir) Red }
Write-Status ('Dashboard: http://127.0.0.1:{0} (Vite will print the Network URL)' -f $frontPort) Green
Write-Status 'Stop everything cleanly with: .\stop-command-centre.ps1' DarkGray
