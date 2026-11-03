# Downloads a full backup of ODDLY's database (public data + Supabase auth users)
# into backups\ as a pg_dump custom-format file.
#
#   powershell -ExecutionPolicy Bypass -File scripts\db-backup.ps1
#
# Needs pg_dump 17+ (PostgreSQL client tools), e.g.:  winget install PostgreSQL.PostgreSQL.17
# Restore instructions: docs/OPERATIONS.md. Backups contain personal data — store them
# encrypted (e.g. a BitLocker drive or an encrypted cloud folder) and never commit them.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    $candidate = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { $pgDump = $candidate.FullName } else { throw "pg_dump not found. Install it with: winget install PostgreSQL.PostgreSQL.17" }
} else {
    $pgDump = $pgDump.Source
}

$line = Get-Content (Join-Path $root "backend/.env") | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL is missing from backend/.env" }
$db = ($line -split '=', 2)[1].Trim()

$dir = Join-Path $root "backups"
New-Item -ItemType Directory -Force $dir | Out-Null
$file = Join-Path $dir ("oddly-{0}.dump" -f (Get-Date -Format "yyyyMMdd-HHmm"))

$ErrorActionPreference = "Continue"
& $pgDump --dbname="$db" --format=custom --no-owner --no-privileges --schema=public --schema=auth --file="$file" 2>&1 |
    ForEach-Object { "$_" -replace [regex]::Escape($db), '<database>' }
if ($LASTEXITCODE -ne 0) {
    Remove-Item $file -ErrorAction SilentlyContinue
    throw "pg_dump failed (exit $LASTEXITCODE)"
}

$size = [math]::Round((Get-Item $file).Length / 1MB, 2)
Write-Host "Backup written: $file ($size MB)"
Write-Host "Files in Supabase Storage (media, documents) are not in this file - see docs/OPERATIONS.md."
