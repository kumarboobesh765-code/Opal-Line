<#
.SYNOPSIS
  Repeatable smoke test for the Opal Line Billing NSIS installer.

  Silently installs the built installer, verifies the extracted tree
  (app.asar, backend bundle, frontend, PostgreSQL incl. the share/timezone
  data and VC++ runtime DLLs), checks the Authenticode signature and
  uninstall entry, then launches the app and verifies that PostgreSQL
  (127.0.0.1:5433) and the backend API (127.0.0.1:4198/api/v1/health) boot.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test-install.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test-install.ps1 -UpgradeInstall -StopAtEnd
#>
[CmdletBinding()]
param(
  [string]$SetupPath = '',
  [int]$InstallTimeoutSec = 420,
  [int]$BootTimeoutSec = 120,
  [switch]$UpgradeInstall,  # install over the existing copy instead of removing it first
  [switch]$StopAtEnd        # close the app (and its database) when the test finishes
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$instDir = Join-Path $env:LOCALAPPDATA 'Programs\Opal Line Billing'
$appExe = Join-Path $instDir 'Opal Line Billing.exe'
$appDataLogs = Join-Path $env:APPDATA 'Opal Line Billing\logs'
$failures = 0

function Report([string]$name, [bool]$ok, [string]$detail = '') {
  $suffix = if ($detail) { " - $detail" } else { '' }
  if ($ok) {
    Write-Host "[PASS] $name$suffix" -ForegroundColor Green
  } else {
    Write-Host "[FAIL] $name$suffix" -ForegroundColor Red
    $script:failures++
  }
}

function Wait-Port([int]$port, [int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $c = New-Object System.Net.Sockets.TcpClient
      $c.Connect('127.0.0.1', $port)
      $c.Close()
      return $true
    } catch {
      Start-Sleep -Milliseconds 1000
    }
  }
  return $false
}

function Stop-AppStack {
  Get-Process -Name 'Opal Line Billing' -ErrorAction SilentlyContinue | ForEach-Object {
    try { $_.Kill(); $_.WaitForExit(5000) | Out-Null } catch {}
  }
  foreach ($port in 4198, 5433) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
      try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  Start-Sleep -Seconds 1
}

# ── 1. Resolve the installer ────────────────────────────────────────────────
if (-not $SetupPath) {
  $candidates = Get-ChildItem (Join-Path $repoRoot 'dist-electron') -Filter '*Setup-*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  if (-not $candidates) {
    Write-Host 'No installer found in dist-electron - run "npm run electron:build" first.' -ForegroundColor Red
    exit 2
  }
  $SetupPath = $candidates[0].FullName
}
if (-not (Test-Path $SetupPath)) {
  Write-Host "Installer not found: $SetupPath" -ForegroundColor Red
  exit 2
}
Write-Host "Installer: $SetupPath"

$sig = Get-AuthenticodeSignature -LiteralPath $SetupPath
Report 'Installer signature valid' ($sig.Status -eq 'Valid') "status=$($sig.Status)"

# ── 2. Stop any running instance (app, backend, database) ───────────────────
Stop-AppStack

# ── 3. Optional clean slate (fresh-machine simulation) ──────────────────────
if (-not $UpgradeInstall -and (Test-Path $instDir)) {
  Remove-Item $instDir -Recurse -Force -ErrorAction Stop
  Report 'Removed previous install directory' $true
}

# ── 4. Silent install ───────────────────────────────────────────────────────
$setupStart = Get-Date
$proc = Start-Process -FilePath $SetupPath -ArgumentList '/S' -PassThru
$exited = $proc.WaitForExit($InstallTimeoutSec * 1000)
if (-not $exited) {
  try { $proc.Kill() } catch {}
  Report 'Installer finished' $false "timed out after $InstallTimeoutSec s"
} else {
  $secs = [int]((Get-Date) - $setupStart).TotalSeconds
  Report 'Installer finished' ($proc.ExitCode -eq 0) "exit=$($proc.ExitCode) in $secs s"
}

# ── 5. Extracted-tree checks ────────────────────────────────────────────────
Report 'App executable present' (Test-Path $appExe)

$share = Join-Path $instDir 'resources\pgsql\share'
$expectedShare = 1412
$refShare = Join-Path $repoRoot 'dist-electron\win-unpacked\resources\pgsql\share'
if (Test-Path $refShare) {
  $expectedShare = (Get-ChildItem -Recurse -File $refShare -ErrorAction SilentlyContinue | Measure-Object).Count
}
if (Test-Path $share) {
  $actual = (Get-ChildItem -Recurse -File $share -ErrorAction SilentlyContinue | Measure-Object).Count
  Report 'PostgreSQL share data complete' ($actual -ge $expectedShare) "$actual files (expected >= $expectedShare)"
} else {
  Report 'PostgreSQL share data complete' $false 'resources\pgsql\share is missing'
}
Report 'PostgreSQL timezone tables present' (Test-Path (Join-Path $share 'timezone'))

$bundled = @(
  'resources\app.asar',
  'resources\backend\dist\index.cjs',
  'resources\backend\dist\node_modules\argon2',
  'resources\frontend\dist\index.html',
  'resources\pgsql\bin\pg_ctl.exe',
  'resources\pgsql\bin\initdb.exe',
  'resources\pgsql\bin\msvcp140.dll',
  'resources\pgsql\bin\vcruntime140.dll',
  'resources\pgsql-present.flag'
)
foreach ($rel in $bundled) {
  Report "Bundled: $rel" (Test-Path (Join-Path $instDir $rel))
}

# ── 6. Installed-app signature ──────────────────────────────────────────────
if (Test-Path $appExe) {
  $appSig = Get-AuthenticodeSignature -LiteralPath $appExe
  Report 'Installed app signature valid' ($appSig.Status -eq 'Valid') "status=$($appSig.Status)"
}

# ── 7. Uninstall registry entry ─────────────────────────────────────────────
$uninst = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
  Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -match 'Opal Line Billing' }
Report 'Uninstall registry entry present' ($null -ne $uninst)

# ── 8. Boot the app and verify PostgreSQL + backend ─────────────────────────
$launch = Start-Process -FilePath $appExe -PassThru
Report 'App process started' (-not $launch.HasExited) "PID $($launch.Id)"

$pgUp = Wait-Port 5433 $BootTimeoutSec
Report 'PostgreSQL listening on 5433' $pgUp

$apiUp = $false
$healthOk = $false
$deadline = (Get-Date).AddSeconds([Math]::Min(60, $BootTimeoutSec))
while ((Get-Date) -lt $deadline -and -not $apiUp) {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4198/api/v1/health' -UseBasicParsing -TimeoutSec 5
    $apiUp = $true
    $healthOk = ($r.StatusCode -eq 200 -and $r.Content -match '"ok"\s*:\s*true')
  } catch {
    Start-Sleep -Milliseconds 1500
  }
}
Report 'Backend health endpoint responds' $apiUp 'http://127.0.0.1:4198/api/v1/health'
Report 'Health payload ok=true' $healthOk

if (-not ($pgUp -and $healthOk)) {
  Write-Host "`n--- diagnostics: app.log (tail) ---" -ForegroundColor Yellow
  Get-Content (Join-Path $appDataLogs 'app.log') -Tail 25 -ErrorAction SilentlyContinue
  Write-Host "--- diagnostics: postgres.log (tail) ---" -ForegroundColor Yellow
  Get-Content (Join-Path $appDataLogs 'postgres.log') -Tail 15 -ErrorAction SilentlyContinue
}

# ── 9. Summary ──────────────────────────────────────────────────────────────
if ($StopAtEnd) {
  Stop-AppStack
  Write-Host 'Stopped the app (StopAtEnd).'
}

Write-Host ''
if ($failures -eq 0) {
  Write-Host 'SMOKE TEST PASSED' -ForegroundColor Green
  exit 0
}
Write-Host "SMOKE TEST FAILED - $failures check(s) failed" -ForegroundColor Red
exit 1
