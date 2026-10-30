# Starts ODDLY on this computer: the API, then the desktop app.
# While the desktop app is running, the same app is also available in any browser at
# http://localhost:1420
#
# Usage: right-click > "Run with PowerShell", or from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts/start-oddly.ps1
$root = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -and (Test-Path $cargoBin)) {
    $env:Path = "$cargoBin;$env:Path"
}

function Test-Port($port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

# 1. API (port 8080) in its own window, unless it's already running.
if (Test-Port 8080) {
    Write-Host "API is already running on port 8080."
} else {
    Write-Host "Starting the ODDLY API in a new window..."
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "`$env:Path = '$cargoBin;' + `$env:Path; Set-Location '$root'; `$host.UI.RawUI.WindowTitle = 'ODDLY API'; cargo run -p oddly-api"
    )
    Write-Host "Waiting for the API to be ready (the first start compiles and can take a few minutes)..."
    $deadline = (Get-Date).AddMinutes(10)
    while (-not (Test-Port 8080) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
}

# 2. Desktop app (also serves the browser version on port 1420).
if (Test-Port 1420) {
    Write-Host "The app is already running. Open http://localhost:1420 in your browser."
} else {
    Write-Host "Starting the desktop app. Browser version: http://localhost:1420"
    & (Join-Path $PSScriptRoot "dev-desktop.ps1")
}
