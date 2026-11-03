# Builds the signed Windows installer and the auto-update manifest.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-desktop-release.ps1 [-Notes "What's new"]
#
# Output: release\updates\  ->  upload its contents to https://app.workwithoddly.com/updates/
# (see docs/DEPLOYMENT.md). The installer talks to the API in desktop\.env.production.
#
# Needs the updater signing key at %USERPROFILE%\.tauri\oddly-updater.key (never commit it).
# Losing that key means installed apps can no longer receive updates — keep a backup.

param([string]$Notes = "")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root "desktop"
$keyPath = Join-Path $env:USERPROFILE ".tauri\oddly-updater.key"

if (-not (Test-Path $keyPath)) { throw "Updater signing key not found at $keyPath" }
if (-not (Test-Path (Join-Path $desktop ".env.production"))) { throw "desktop\.env.production is missing" }

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path $cargoBin) -and ($env:PATH -notlike "*$cargoBin*")) { $env:PATH = "$cargoBin;$env:PATH" }

$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyPath -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
$env:CARGO_TARGET_DIR = Join-Path $root "target"

Push-Location $desktop
try {
    $ErrorActionPreference = "Continue"
    npm run tauri build -- --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
    $ErrorActionPreference = "Stop"
} finally {
    Pop-Location
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
}

$version = (Get-Content (Join-Path $desktop "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
$bundle = Join-Path $root "target\release\bundle\nsis"
$installer = Get-ChildItem $bundle -Filter "*_${version}_x64-setup.exe" | Select-Object -First 1
if (-not $installer) { throw "Installer for $version not found in $bundle" }
$sig = Get-Content "$($installer.FullName).sig" -Raw

$out = Join-Path $root "release\updates"
New-Item -ItemType Directory -Force $out | Out-Null
$fileName = "ODDLY_${version}_x64-setup.exe"
Copy-Item $installer.FullName (Join-Path $out $fileName) -Force

$manifest = [ordered]@{
    version   = $version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $sig.Trim()
            url       = "https://app.workwithoddly.com/updates/$fileName"
        }
    }
}
$json = $manifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $out "latest.json"), $json, (New-Object Text.UTF8Encoding $false))

Write-Host ""
Write-Host "Built ODDLY $version"
Write-Host "  $out\$fileName"
Write-Host "  $out\latest.json"
Write-Host "Upload both files to https://app.workwithoddly.com/updates/"
