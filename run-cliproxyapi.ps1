$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PSScriptRoot).Path
$toolsDir = if ($env:COMMAND_CENTRE_TOOLS_DIR) { $env:COMMAND_CENTRE_TOOLS_DIR } else { 'C:\tools\CLIProxyAPI' }
$exe = Join-Path $toolsDir 'cli-proxy-api.exe'
$config = Join-Path $toolsDir 'config.yaml'
if (-not (Test-Path -LiteralPath $exe)) { throw "CLIProxyAPI executable not found: $exe" }
if (-not (Test-Path -LiteralPath $config)) { throw "CLIProxyAPI config not found: $config" }
$listener = Get-NetTCPConnection -LocalPort 8317 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    Write-Host "CLIProxyAPI is already running on port 8317 (PID $($listener.OwningProcess)). Leave that terminal running." -ForegroundColor Green
    exit 0
}
Write-Host "CLIProxyAPI → http://127.0.0.1:8317" -ForegroundColor Yellow
Set-Location $toolsDir
& $exe -config $config
