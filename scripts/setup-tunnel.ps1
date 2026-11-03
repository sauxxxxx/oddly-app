# One-time setup: connects https://api.workwithoddly.com to the ODDLY API on this PC through
# a Cloudflare Tunnel. No router ports are opened; the PC makes an outbound connection.
#
#   1. cloudflared tunnel login          (opens the browser; pick workwithoddly.com)
#   2. powershell -ExecutionPolicy Bypass -File scripts\setup-tunnel.ps1
#   3. powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
#
# Files live in %USERPROFILE%\.cloudflared (never commit them): cert.pem (account access),
# <tunnel-id>.json (tunnel credentials) and oddly.yml (the config written below).

param([string]$Hostname = "api.workwithoddly.com", [string]$TunnelName = "oddly")

$ErrorActionPreference = "Stop"

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) {
        if (Test-Path $p) { return $p }
    }
    throw "cloudflared not found. Install it with: winget install Cloudflare.cloudflared"
}

$cf = Find-Cloudflared
$dir = Join-Path $env:USERPROFILE ".cloudflared"
if (-not (Test-Path (Join-Path $dir "cert.pem"))) {
    throw "Not signed in to Cloudflare yet. Run: & '$cf' tunnel login   (then choose workwithoddly.com)"
}

$ErrorActionPreference = "Continue"
$tunnels = & $cf tunnel list --output json 2>$null | ConvertFrom-Json
$tunnel = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
if (-not $tunnel) {
    Write-Host "Creating tunnel '$TunnelName'..."
    & $cf tunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) { throw "Creating the tunnel failed" }
    $tunnel = (& $cf tunnel list --output json 2>$null | ConvertFrom-Json) | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}
$ErrorActionPreference = "Stop"
if (-not $tunnel) { throw "Tunnel '$TunnelName' not found after creating it" }
$id = $tunnel.id
$credentials = Join-Path $dir "$id.json"
if (-not (Test-Path $credentials)) { throw "Tunnel credentials $credentials are missing (the tunnel was created on another PC?)" }

$config = @"
tunnel: $id
credentials-file: $credentials
ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:8080
  - service: http_status:404
"@
[IO.File]::WriteAllText((Join-Path $dir "oddly.yml"), $config, (New-Object Text.UTF8Encoding $false))
Write-Host "Wrote $dir\oddly.yml"

Write-Host "Pointing $Hostname at the tunnel..."
$ErrorActionPreference = "Continue"
& $cf tunnel route dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Couldn't create the DNS record. If $Hostname already has a record in Cloudflare DNS, delete it and run this script again."
} else {
    Write-Host ""
    Write-Host "Done. Start ODDLY's server with: powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1"
}
