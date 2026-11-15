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
$apiPort = if ($env:COMMAND_CENTRE_API_PORT) { $env:COMMAND_CENTRE_API_PORT } else { '8001' }
$env:VITE_COMMAND_CENTRE_API = "http://127.0.0.1:$apiPort"
$frontPort = 3001
while ($frontPort -lt 3100) {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $frontPort)
    try { $probe.Start(); $probe.Stop(); break } catch { $probe.Stop(); $frontPort++ }
}
$env:VITE_COMMAND_CENTRE_FRONTEND_PORT = "$frontPort"
Write-Host "Hive Orbit Command Deck → http://127.0.0.1:$frontPort" -ForegroundColor Magenta
Write-Host "Backend API → $env:VITE_COMMAND_CENTRE_API" -ForegroundColor DarkGray
Set-Location (Join-Path $root 'frontend')
& npm run dev
