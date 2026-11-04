# Deploys the ODDLY API to the VPS from the current git commit.
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-vps.ps1 -Server root@<vps-ip> [-BuildOnly] [-UpdateEnv]
#
# Uploads the source to /opt/scout/src, builds the image on the VPS (2 of 4 CPU cores, so the
# other live apps keep running normally) and restarts only ODDLY's container. Uncommitted
# changes are not deployed. The VPS has other apps on it: this touches nothing outside
# /opt/scout and the `scout` Docker project.
#
#   -BuildOnly   build the image but don't start or restart the container
#   -UpdateEnv   also copy backend\.env to /opt/scout/.env (first deploy, or when secrets change)

param(
    [Parameter(Mandatory)][string]$Server,   # e.g. root@203.0.113.10 (kept out of the repo)
    [string]$KeyPath = (Join-Path $env:USERPROFILE ".ssh\oddly_vps"),
    [switch]$BuildOnly,
    [switch]$UpdateEnv
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ssh = @("-i", $KeyPath, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20")

function Remote([string]$command) {
    $ErrorActionPreference = "Continue"
    & ssh @ssh $Server $command
    if ($LASTEXITCODE -ne 0) { throw "Remote step failed: $command" }
    $ErrorActionPreference = "Stop"
}

$archive = Join-Path $env:TEMP "scout-src.tar.gz"
Push-Location $root
try { git archive --format=tar.gz -o $archive HEAD } finally { Pop-Location }

Remote "mkdir -p /opt/scout/src && chmod 700 /opt/scout"
& scp @ssh $archive "${Server}:/opt/scout/src.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "Uploading the source failed" }
Remove-Item $archive

if ($UpdateEnv) {
    # Never printed; readable only by root on the server.
    & scp @ssh (Join-Path $root "backend\.env") "${Server}:/opt/scout/.env"
    if ($LASTEXITCODE -ne 0) { throw "Uploading .env failed" }
    # Windows line endings would end up inside the values.
    Remote "chmod 600 /opt/scout/.env && sed -i 's/\r`$//' /opt/scout/.env"
}

Remote "cd /opt/scout && rm -rf src && mkdir src && tar -xzf src.tar.gz -C src && rm src.tar.gz && cp src/deploy/compose.vps.yml compose.yml"
Remote "cd /opt/scout/src && docker build --build-arg CARGO_BUILD_JOBS=2 -t scout-api:local ."

if ($BuildOnly) {
    Write-Host "Image built. Container not started (-BuildOnly)."
    return
}

Remote "cd /opt/scout && docker compose up -d --no-build && docker compose ps"
Write-Host "Deployed. Health: https://scout.remarugsimar.com/api/v1/health"
