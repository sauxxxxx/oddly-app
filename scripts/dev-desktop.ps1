# Runs the ODDLY desktop app in development mode (Tauri window + hot reload).
# Usage (from the repo root):  powershell -ExecutionPolicy Bypass -File scripts/dev-desktop.ps1
# The API must be running separately (cargo run -p oddly-api).
$root = Split-Path -Parent $PSScriptRoot

# Shells opened before Rust was installed don't have cargo on PATH yet.
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -and (Test-Path $cargoBin)) {
    $env:Path = "$cargoBin;$env:Path"
}

# Separate build folder so building the app doesn't wait on a running API build.
$env:CARGO_TARGET_DIR = Join-Path $root "target\desktop"

Set-Location (Join-Path $root "desktop")
npm run tauri dev
