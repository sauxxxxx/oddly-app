# Applies pending migrations in supabase/migrations to the database in backend/.env.
# Usage (from the repo root):  powershell -File scripts/db-push.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$line = Get-Content (Join-Path $root "backend/.env") | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL is missing from backend/.env" }
$db = ($line -split '=', 2)[1].Trim()
Push-Location $root
# The CLI prints progress on stderr; don't treat that as a failure.
$ErrorActionPreference = "Continue"
try {
    "Y" | npx --yes supabase@latest db push --db-url "$db" 2>&1 | ForEach-Object { $_ -replace [regex]::Escape($db), '<database>' }
} finally {
    Pop-Location
}
