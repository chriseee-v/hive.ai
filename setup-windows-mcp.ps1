$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
$python = Get-Command python.exe -ErrorAction SilentlyContinue
if ($pyLauncher) {
    $pythonCommand = $pyLauncher.Source
    $pythonArgs = @('-3')
} elseif ($python) {
    $isVirtualEnv = (& $python.Source -c "import sys; print(sys.prefix != sys.base_prefix)").Trim()
    if ($isVirtualEnv -eq 'True') {
        throw 'The active Python is the project virtual environment. Install setup dependencies with the system Python: close this terminal, open a new PowerShell window, and run .\setup-windows-mcp.ps1.'
    }
    $pythonCommand = $python.Source
    $pythonArgs = @()
} else {
    throw 'Python was not found. Install Python 3.11 or newer, open a new PowerShell window, then run this setup again.'
}

Write-Host '[1/3] Installing the free uv runner for your Windows user…' -ForegroundColor Cyan
& $pythonCommand @pythonArgs -m pip install --user uv
if ($LASTEXITCODE -ne 0) { throw 'Could not install uv. Check your internet connection and Python pip, then run this setup again.' }

$scriptDirectory = (& $pythonCommand @pythonArgs -c "import sysconfig; print(sysconfig.get_path('scripts', scheme='nt_user'))").Trim()
$uvx = Join-Path $scriptDirectory 'uvx.exe'
if (-not (Test-Path -LiteralPath $uvx)) {
    $found = Get-Command uvx -ErrorAction SilentlyContinue
    if ($found) { $uvx = $found.Source }
    else { throw "uv installed, but uvx.exe was not found under $scriptDirectory." }
}

Write-Host '[2/3] Downloading Windows-MCP and preparing its Python 3.14 runtime…' -ForegroundColor Cyan
$pythonInstallDirectory = Join-Path $projectRoot '.uv\python'
$cacheDirectory = Join-Path $projectRoot '.uv\cache'
$toolDirectory = Join-Path $projectRoot '.uv\tools'
New-Item -ItemType Directory -Force -Path $pythonInstallDirectory, $cacheDirectory, $toolDirectory | Out-Null
$env:UV_PYTHON_INSTALL_DIR = $pythonInstallDirectory
$env:UV_CACHE_DIR = $cacheDirectory
$env:UV_TOOL_DIR = $toolDirectory
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$setupOutput = & $uvx --python 3.14 windows-mcp serve --help 2>&1
$setupExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($setupExitCode -ne 0) {
    $setupOutput | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
    throw 'Windows-MCP could not be prepared. Check network access and Python 3.14 support in uv, then retry.'
}

Write-Host '[3/3] Enabling the restricted desktop bridge in this project…' -ForegroundColor Cyan
$envFile = Join-Path $projectRoot '.env'
$content = if (Test-Path -LiteralPath $envFile) { Get-Content -LiteralPath $envFile -Raw } else { '' }
# Recover cleanly if an earlier PowerShell version joined existing .env entries onto one line.
$content = [regex]::Replace($content, '(?<!\n)(?=COMMAND_CENTRE_WINDOWS_MCP_ENABLED=|COMMAND_CENTRE_WINDOWS_MCP_COMMAND=|UV_PYTHON_INSTALL_DIR=|UV_CACHE_DIR=|UV_TOOL_DIR=)', "`r`n")
$settings = [ordered]@{
    COMMAND_CENTRE_WINDOWS_MCP_ENABLED = 'true'
    COMMAND_CENTRE_WINDOWS_MCP_COMMAND = $uvx
    UV_PYTHON_INSTALL_DIR = $pythonInstallDirectory
    UV_CACHE_DIR = $cacheDirectory
    UV_TOOL_DIR = $toolDirectory
}
foreach ($key in $settings.Keys) {
    $pattern = '(?m)^\s*' + [regex]::Escape($key) + '=.*$'
    $value = "$key=`"$($settings[$key])`""
    if ([regex]::IsMatch($content, $pattern)) { $content = [regex]::Replace($content, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $value }) }
    else { $content = $content.TrimEnd("`r", "`n") + "`r`n" + $value + "`r`n" }
}
[System.IO.File]::WriteAllText($envFile, $content, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Windows-MCP is installed and enabled. Restart the Command Centre to connect it.' -ForegroundColor Green
Write-Host 'The orchestrator is limited to desktop, app-launch, and screen-inspection tools; each action remains approval-gated.' -ForegroundColor DarkGray
