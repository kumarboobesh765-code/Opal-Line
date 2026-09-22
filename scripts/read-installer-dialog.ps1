$ErrorActionPreference = 'Continue'
try {
  $lines = [WinEnum]::Dump(5528)
  if ($lines) { $lines | ForEach-Object { Write-Output $_ } } else { Write-Output "WinEnum: no windows found for 5528" }
} catch {
  Write-Output ("WinEnum failed: " + $_.Exception.Message)
}
$p = Get-Process -Id 5528 -ErrorAction SilentlyContinue
if ($p) {
  Write-Output ("mainwindow=[" + $p.MainWindowTitle + "] responding=" + $p.Responding + " cpu=" + $p.CPU)
} else {
  Write-Output "process 5528 gone"
}
