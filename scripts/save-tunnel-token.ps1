# Saves the Cloudflare Tunnel token for ODDLY's server on this PC.
#
#   powershell -ExecutionPolicy Bypass -File scripts\save-tunnel-token.ps1
#
# Use this when the tunnel is created in the Cloudflare dashboard of the account that manages
# workwithoddly.com (Zero Trust → Networks → Tunnels), which hands out a token. The token is
# typed in hidden and stored encrypted with Windows DPAPI, readable only by this Windows user
# on this PC. It is never written to the project folder.
# (Alternative when you own the Cloudflare account: scripts\setup-tunnel.ps1.)

$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE ".cloudflared"
New-Item -ItemType Directory -Force $dir | Out-Null

$secure = Read-Host "Paste the tunnel token (input is hidden), then press Enter" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$plain = $plain.Trim()
# Accept the whole install command too ("cloudflared ... --token eyJ...").
if ($plain -match '--token\s+(\S+)') { $plain = $Matches[1] }
if ($plain.Length -lt 50 -or $plain -notmatch '^[A-Za-z0-9_\-=]+$') {
    throw "That doesn't look like a tunnel token. Copy the long string after --token in Cloudflare."
}

ConvertTo-SecureString $plain -AsPlainText -Force | ConvertFrom-SecureString |
    Set-Content -Path (Join-Path $dir "oddly-token.dpapi") -Encoding ASCII
$plain = $null
Write-Host "Token saved (encrypted) to $dir\oddly-token.dpapi"
Write-Host "Start the server with: powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1"
