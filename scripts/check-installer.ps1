$p = Get-Process -Id 6264 -ErrorAction SilentlyContinue
if ($p) {
  $p | Select-Object Id, CPU, WorkingSet, Responding, StartTime | Format-List
  Start-Sleep 5
  $p2 = Get-Process -Id 6264
  Write-Output ("CPU delta over 5s: " + ($p2.CPU - $p.CPU))
} else {
  Write-Output "process gone"
}
Write-Output "=== newest files in install dir ==="
Get-ChildItem "$env:LOCALAPPDATA\Programs\Opal Line Billing" -Recurse -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5 LastWriteTime, Length, Name |
  Format-Table -AutoSize
Write-Output "=== installer child processes ==="
Get-CimInstance Win32_Process -Filter "ParentProcessId=6264" | Select-Object ProcessId, Name, CommandLine | Format-List
