$ErrorActionPreference = 'SilentlyContinue'
$root = (Resolve-Path $PSScriptRoot).Path
$runDir = Join-Path $root '.run'

function Stop-Tree([int]$pid, [string]$label) {
    if (-not (Get-Process -Id $pid -ErrorAction SilentlyContinue)) { return }
    Write-Host "Stopping $label [$pid]" -ForegroundColor Yellow
    & taskkill.exe /PID $pid /T 2>$null | Out-Null
    for ($i = 0; $i -lt 12; $i++) {
        if (-not (Get-Process -Id $pid -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    }
    Write-Host "Forcing remaining process tree [$pid]" -ForegroundColor DarkYellow
    & taskkill.exe /PID $pid /T /F 2>$null | Out-Null
}

function Clear-Port {
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$Ports,

        [int]$WaitMs = 800
    )

    foreach ($port in $Ports) {
        $ownerPids = @(
            Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
        )

        if ($ownerPids) {
            Write-Host ("Port {0} is in use by PID(s): {1}. Stopping..." -f $port, ($ownerPids -join ', ')) -ForegroundColor Yellow
            foreach ($ownerPid in $ownerPids) {
                try {
                    Stop-Process -Id $ownerPid -Force -ErrorAction Stop
                    Write-Host ("  Stopped PID {0}" -f $ownerPid) -ForegroundColor Green
                }
                catch {
                    Write-Host ("  Could not stop PID {0}: {1}" -f $ownerPid, $_.Exception.Message) -ForegroundColor Red
                }
            }
            Start-Sleep -Milliseconds $WaitMs
        }
        else {
            Write-Host ("Port {0} is free." -f $port) -ForegroundColor DarkGray
        }
    }
}

$stopped = $false
if (Test-Path -LiteralPath $runDir) {
    Get-ChildItem -LiteralPath $runDir -Filter '*.pid' -File | ForEach-Object {
        $raw = (Get-Content -LiteralPath $_.FullName -Raw).Trim()
        if ($raw -match '^\d+$') {
            Stop-Tree ([int]$raw) $_.BaseName
            $stopped = $true
        }
        Remove-Item -LiteralPath $_.FullName -Force
    }
}

# Clean up older sessions that were started before PID tracking was installed.
try {
    $inventory = @(Get-CimInstance Win32_Process)
    $legacy = $inventory | Where-Object {
        $_.CommandLine -and ($_.CommandLine -like "*$root*" -or $_.CommandLine -like "*$(($root -replace '\\','/'))*") -and
        ($_.CommandLine -match 'uvicorn app\.main:app' -or $_.CommandLine -match 'npm(\.cmd)? run dev' -or $_.CommandLine -match 'vite.*dev')
    }
    foreach ($item in $legacy) { Stop-Tree ([int]$item.ProcessId) "legacy Command Centre process"; $stopped = $true }
} catch {}

# Clean fixed-port processes that may have survived before PID tracking was added.
# Only target recognizable Command Centre backend/frontend command lines.
foreach ($port in @(8001, 3001)) {
    try {
        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        foreach ($listener in $listeners) {
            $processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue
            $processName = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            $isRecognized = $processInfo.CommandLine -and ($processInfo.CommandLine -match 'uvicorn\s+app\.main:app' -or $processInfo.CommandLine -match 'vite.*dev' -or $processInfo.CommandLine -match 'npm(\.cmd)?\s+run\s+dev')
            $isFixedPortRuntime = $processName -in @('python', 'python3', 'node', 'npm')
            if ($isRecognized -or $isFixedPortRuntime) {
                Stop-Tree ([int]$listener.OwningProcess) ('fixed-port Command Centre process on {0}' -f $port)
                $stopped = $true
            }
        }
    } catch {}
}

Clear-Port -Ports @(8001, 3001)

if ($stopped) { Write-Host 'Command Centre services stopped cleanly.' -ForegroundColor Green }
else { Write-Host 'No Command Centre services were running.' -ForegroundColor DarkGray }
