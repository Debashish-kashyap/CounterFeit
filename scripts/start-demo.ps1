$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$demoDir = Join-Path $repoRoot ".local-demo"
$dataDir = Join-Path $demoDir "postgres-data"
$logFile = Join-Path $demoDir "postgres.log"
$postgresBinDir = Join-Path $backendDir "node_modules\@embedded-postgres\windows-x64\native\bin"
$databasePort = 55433

if ($env:OS -ne "Windows_NT" -or [Environment]::Is64BitOperatingSystem -eq $false) {
  throw "The no-Docker demo launcher currently requires 64-bit Windows."
}

$nodeVersionText = (& node.exe --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch "^v(\d+)\.(\d+)\.") {
  throw "Node.js 20.19+, 22.12+, or 24+ is required."
}
$nodeMajor = [int]$Matches[1]
$nodeMinor = [int]$Matches[2]
if (
  ($nodeMajor -eq 20 -and $nodeMinor -lt 19) -or
  ($nodeMajor -eq 22 -and $nodeMinor -lt 12) -or
  ($nodeMajor -lt 20) -or
  ($nodeMajor -gt 20 -and $nodeMajor -lt 22) -or
  ($nodeMajor -eq 21) -or
  ($nodeMajor -eq 23)
) {
  throw "Node.js 20.19+, 22.12+, or 24+ is required; found $nodeVersionText."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm was not found. Install Node.js with npm and run this command again."
}

$env:DATABASE_URL = "postgresql://veripack@127.0.0.1:$databasePort/veripack?schema=public"
$env:NODE_ENV = "development"
$env:PORT = "3001"
$env:FRONTEND_ORIGIN = "http://localhost:3000"
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:3001"

function Install-WorkspaceDependencies(
  [string]$workspaceDir,
  [string]$requiredDependency
) {
  $lockFile = Join-Path $workspaceDir "package-lock.json"
  $installMarker = Join-Path $workspaceDir "node_modules\.package-lock.json"
  $needsInstall = -not (Test-Path $installMarker) -or -not (Test-Path $requiredDependency)
  if (-not $needsInstall) {
    $needsInstall = (Get-Item $lockFile).LastWriteTimeUtc -gt (Get-Item $installMarker).LastWriteTimeUtc
  }

  if ($needsInstall) {
    Write-Host "Installing dependencies in $([IO.Path]::GetFileName($workspaceDir))..."
    Push-Location $workspaceDir
    try {
      & npm.cmd ci
      if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed in $workspaceDir."
      }
    } finally {
      Pop-Location
    }
  }
}

function Assert-PortAvailable([int]$port) {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
  try {
    $listener.Start()
  } catch {
    throw "Port $port is already in use. Stop the other service using it and retry."
  } finally {
    $listener.Stop()
  }
}

function Wait-ForHttpEndpoint([string]$uri, [int]$timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $uri -TimeoutSec 2 -UseBasicParsing
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return
      }
    } catch {
    }
    Start-Sleep -Seconds 1
  }
  throw "Service did not become ready at $uri within $timeoutSeconds seconds."
}

$initdb = Join-Path $postgresBinDir "initdb.exe"
$pgCtl = Join-Path $postgresBinDir "pg_ctl.exe"
$postgresExe = Join-Path $postgresBinDir "postgres.exe"
Install-WorkspaceDependencies $backendDir $postgresExe
Install-WorkspaceDependencies $frontendDir (Join-Path $frontendDir "node_modules\next\package.json")

if (-not (Test-Path $initdb) -or -not (Test-Path $pgCtl) -or -not (Test-Path $postgresExe)) {
  throw "The portable PostgreSQL binaries are missing. Reinstall backend dependencies with npm ci."
}

New-Item -ItemType Directory -Force -Path $demoDir | Out-Null
Assert-PortAvailable $databasePort
Assert-PortAvailable 3000
Assert-PortAvailable 3001

if (-not (Test-Path $dataDir)) {
  Write-Host "Initializing the local PostgreSQL database..."
  & $initdb -D $dataDir -U veripack --auth-local=trust --auth-host=trust --encoding=UTF8 --no-locale
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL initialization failed."
  }
} elseif (-not (Test-Path (Join-Path $dataDir "PG_VERSION"))) {
  throw "The local PostgreSQL data directory is incomplete. Remove .local-demo\postgres-data and rerun start-demo.cmd."
}

Write-Host "Starting PostgreSQL on 127.0.0.1:$databasePort..."
& $pgCtl start -D $dataDir -o "-h 127.0.0.1 -p $databasePort" -l $logFile -w
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL failed to start. See $logFile."
}

Push-Location $backendDir
try {
  Write-Host "Applying database migrations..."
  & npm.cmd run db:deploy
  if ($LASTEXITCODE -ne 0) {
    throw "Database migrations failed."
  }

  Write-Host "Generating Prisma client..."
  & npm.cmd run db:generate
  if ($LASTEXITCODE -ne 0) {
    throw "Prisma client generation failed."
  }

  Write-Host "Creating fresh evaluator demo data..."
  & npm.cmd run seed:reset
  if ($LASTEXITCODE -ne 0) {
    throw "Demo database seeding failed."
  }
} finally {
  Pop-Location
}

Write-Host "Starting backend and frontend..."
Start-Process -FilePath "npm.cmd" -ArgumentList "run start:dev" -WorkingDirectory $backendDir | Out-Null
Wait-ForHttpEndpoint "http://127.0.0.1:3001/health" 60

$env:PORT = "3000"
Start-Process -FilePath "npm.cmd" -ArgumentList "run dev" -WorkingDirectory $frontendDir | Out-Null
Wait-ForHttpEndpoint "http://127.0.0.1:3000" 60
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "Demo is ready at http://localhost:3000"
Write-Host "Backend API: http://localhost:3001/docs"
Write-Host "Demo accounts use password DemoPass123!"
Write-Host "The demo database is recreated each time this launcher runs."
Write-Host "Use stop-demo.cmd to stop the local PostgreSQL process."
