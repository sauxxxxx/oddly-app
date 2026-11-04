# Builds the signed Windows installer and the auto-update manifest, then publishes them.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-desktop-release.ps1 [-Notes "What's new"] [-SkipUpload]
#
# Output: release\updates\ (installer + latest.json). Unless -SkipUpload is given, both are
# uploaded to the private Supabase Storage bucket `releases` (using backend\.env), where the
# API serves them: installed apps update themselves and new teammates download from
#   https://scout.remarugsimar.com/api/v1/updates/download
# The installer talks to the API in desktop\.env.production.
#
# Needs the updater signing key at %USERPROFILE%\.tauri\oddly-updater.key (never commit it).
# Losing that key means installed apps can no longer receive updates — keep a backup.

param([string]$Notes = "", [switch]$SkipUpload)

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
            url       = "https://scout.remarugsimar.com/api/v1/updates/$fileName"
        }
    }
}
$json = $manifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $out "latest.json"), $json, (New-Object Text.UTF8Encoding $false))

Write-Host ""
Write-Host "Built ODDLY $version"
Write-Host "  $out\$fileName"
Write-Host "  $out\latest.json"

if ($SkipUpload) { return }

# Upload with the service key from backend\.env (never printed). Installer first, manifest
# last, so latest.json never points at a file that isn't there yet.
$envFile = Get-Content (Join-Path $root "backend\.env")
function EnvValue($name) {
    $line = $envFile | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
    if (-not $line) { throw "$name is missing from backend\.env" }
    ($line -split '=', 2)[1].Trim()
}
$supabaseUrl = (EnvValue "SUPABASE_URL").TrimEnd('/')
$secret = EnvValue "SUPABASE_SECRET_KEY"
$headers = @{ apikey = $secret; "x-upsert" = "true"; "cache-control" = "no-cache" }
if ($secret.StartsWith("eyJ")) { $headers.Authorization = "Bearer $secret" }

$files = @(
    @{ Name = $fileName; Type = "application/octet-stream" },
    @{ Name = "latest.json"; Type = "application/json" }
)
foreach ($item in $files) {
    try {
        Invoke-RestMethod -Method Post -Uri "$supabaseUrl/storage/v1/object/releases/$($item.Name)" -Headers $headers `
            -ContentType $item.Type -InFile (Join-Path $out $item.Name) | Out-Null
        Write-Host "Uploaded $($item.Name)"
    } catch {
        throw "Uploading $($item.Name) failed: $($_.Exception.Message). Has the 'releases' bucket been created (scripts\db-push.ps1)?"
    }
}
Write-Host ""
Write-Host "Published. New teammates download from https://scout.remarugsimar.com/api/v1/updates/download"
