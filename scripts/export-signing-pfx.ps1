# Exports the local "Opal Line Billing" code-signing certificate so it can be
# stored as the WIN_SIGNING_PFX_B64 repository secret used by
# .github/workflows/release.yml.
#
# Usage:
#   powershell -NoProfile -File scripts/export-signing-pfx.ps1
#
# Then (with the GitHub CLI):
#   gh secret set WIN_SIGNING_PFX_B64 -f dist-electron/code-signing.b64
#
# The PFX has no password; WIN_SIGNING_PFX_PASSWORD may be left unset.
param(
  [string]$Subject = 'Opal Line Billing',
  [string]$OutBase = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutBase) {
  $OutBase = Join-Path $repoRoot 'dist-electron\code-signing'
}

$cert = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.Subject -eq "CN=$Subject" } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $cert) {
  throw "No certificate with subject CN=$Subject found in Cert:\CurrentUser\My. Create one first, e.g. New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=$Subject'"
}

$outDir = Split-Path -Parent $OutBase
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$pfxPath = "$OutBase.pfx"
$b64Path = "$OutBase.b64"

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password (New-Object System.Security.SecureString) | Out-Null
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfxPath))
[IO.File]::WriteAllText($b64Path, $b64)

Write-Host "Certificate : $($cert.Subject) [$($cert.Thumbprint)] expires $($cert.NotAfter)"
Write-Host "PFX         : $pfxPath ($((Get-Item $pfxPath).Length) bytes)"
Write-Host "Base64      : $b64Path ($($b64.Length) chars)"
Write-Host ''
Write-Host 'Set the repo secret with:'
Write-Host "  gh secret set WIN_SIGNING_PFX_B64 -f `"$b64Path`""
