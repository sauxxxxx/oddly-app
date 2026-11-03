# Runs ODDLY's server on this PC for the whole team: the API (release build, settings from
# backend\.env) plus the Cloudflare Tunnel that publishes it at https://api.workwithoddly.com.
# Keep this window open — closing it, or the PC sleeping, takes ODDLY offline for everyone.
# Either process is restarted automatically if it stops. Logs: logs\api.log, logs\tunnel.log.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -InstallStartup   # also start at sign-in
#
# One-time setup first, either:
#   scripts\save-tunnel-token.ps1   tunnel created in the Cloudflare dashboard (token), or
#   scripts\setup-tunnel.ps1        tunnel created from this PC (cloudflared tunnel login).

param([switch]$InstallStartup)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if ($InstallStartup) {
    $startup = [Environment]::GetFolderPath("Startup")
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut((Join-Path $startup "ODDLY server.lnk"))
    $link.TargetPath = "powershell.exe"
    $link.Arguments = "-ExecutionPolicy Bypass -WindowStyle Minimized -File `"$PSCommandPath`""
    $link.WorkingDirectory = $root
    $link.Save()
    Write-Host "ODDLY's server will now start when you sign in to Windows (shortcut in your Startup folder)."
}

$tokenFile = Join-Path $env:USERPROFILE ".cloudflared\oddly-token.dpapi"
$config = Join-Path $env:USERPROFILE ".cloudflared\oddly.yml"
if (Test-Path $tokenFile) {
    # cloudflared reads TUNNEL_TOKEN from the environment, so the token never appears in a command line.
    $secure = Get-Content $tokenFile | ConvertTo-SecureString
    $env:TUNNEL_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    $tunnelArgs = @("tunnel", "--no-autoupdate", "run")
} elseif (Test-Path $config) {
    $tunnelArgs = @("tunnel", "--no-autoupdate", "--config", "`"$config`"", "run")
} else {
    throw "Tunnel not set up. Run scripts\save-tunnel-token.ps1 (token from Cloudflare) or scripts\setup-tunnel.ps1 first."
}
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) { $cf = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe" }
if (-not (Test-Path $cf)) { throw "cloudflared not found. Install it with: winget install Cloudflare.cloudflared" }

$api = Join-Path $root "target\release\oddly-api.exe"
if (-not (Test-Path $api)) {
    Write-Host "Building the API (first time only, takes a few minutes)..."
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
    Push-Location $root
    $ErrorActionPreference = "Continue"
    cargo build --release -p oddly-api
    $ErrorActionPreference = "Stop"
    Pop-Location
    if (-not (Test-Path $api)) { throw "Building the API failed" }
}

if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 8080 is already in use (a development API from start-oddly.ps1?). Close it first."
}

$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Force $logs | Out-Null

# The tunnel forwards every request from 127.0.0.1, so the API reads the real client IP
# (for rate limiting) from Cloudflare's header. It only listens on 127.0.0.1.
$env:TRUST_PROXY = "true"
$env:API_BIND_ADDR = "127.0.0.1:8080"

function Start-Api {
    Start-Process -FilePath $api -WorkingDirectory (Join-Path $root "backend") -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $logs "api.log") -RedirectStandardError (Join-Path $logs "api-error.log")
}
function Start-Tunnel {
    Start-Process -FilePath $cf -ArgumentList $tunnelArgs -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $logs "tunnel-out.log") -RedirectStandardError (Join-Path $logs "tunnel.log")
}

$apiProc = Start-Api
$tunnelProc = Start-Tunnel
Write-Host "ODDLY server running: https://api.workwithoddly.com  (Ctrl+C to stop)"

try {
    while ($true) {
        Start-Sleep -Seconds 5
        if ($apiProc.HasExited) {
            Write-Warning "$(Get-Date -Format T) API stopped (exit $($apiProc.ExitCode)); restarting. See logs\api-error.log"
            Start-Sleep -Seconds 3
            $apiProc = Start-Api
        }
        if ($tunnelProc.HasExited) {
            Write-Warning "$(Get-Date -Format T) Tunnel stopped (exit $($tunnelProc.ExitCode)); restarting. See logs\tunnel.log"
            Start-Sleep -Seconds 3
            $tunnelProc = Start-Tunnel
        }
    }
} finally {
    foreach ($p in @($apiProc, $tunnelProc)) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force } }
    Write-Host "ODDLY server stopped."
}
