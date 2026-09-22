$p = Get-Process -Id 5528 -ErrorAction SilentlyContinue
if ($p) {
  $p | Select-Object Id, CPU, WorkingSet, Responding, StartTime | Format-List
  Start-Sleep 6
  $p2 = Get-Process -Id 5528
  Write-Output ("CPU delta 6s: " + [math]::Round($p2.CPU - $p.CPU, 2))
} else {
  Write-Output "setup process gone"
}
Write-Output "=== Program Files dir ==="
Get-ChildItem "$env:ProgramFiles\Opal Line Billing" -ErrorAction SilentlyContinue |
  Select-Object LastWriteTime, Name | Format-Table -AutoSize
Write-Output "=== child processes of 5528 ==="
Get-CimInstance Win32_Process -Filter "ParentProcessId=5528" |
  Select-Object ProcessId, Name | Format-Table -AutoSize
Write-Output "=== visible top-level windows (UAC?) ==="
Get-Process | Where-Object { $_.MainWindowTitle } |
  Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize
Write-Output "=== elevation of current shell ==="
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
