$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$dataDir = Join-Path $repoRoot ".local-demo\postgres-data"
$pgCtl = Join-Path $repoRoot "backend\node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe"

if (-not (Test-Path $dataDir)) {
  Write-Host "No local demo database was initialized."
  exit 0
}
if (-not (Test-Path $pgCtl)) {
  throw "The PostgreSQL control binary is missing; cannot safely stop the demo database."
}

& $pgCtl status -D $dataDir *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "The local demo database is already stopped."
  exit 0
}

& $pgCtl stop -D $dataDir -m fast -w
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL did not stop cleanly."
}
Write-Host "Demo database stopped. Stop the backend and frontend windows with Ctrl+C."
