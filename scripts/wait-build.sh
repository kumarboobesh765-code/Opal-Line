#!/usr/bin/env bash
# Waits until the Setup.exe mtime is newer than 15:30 today (this build run)
# or the build process disappears. Retries flaky PowerShell reads.
EXE='dist-electron/Opal Line Billing-Setup-1.0.0.exe'
done_marker=$(date -d 'today 15:30' +%s 2>/dev/null || echo 0)
for i in $(seq 1 56); do
  mt=$(stat -c %Y "$EXE" 2>/dev/null || echo 0)
  if [ "$mt" -gt "$done_marker" ] 2>/dev/null; then
    echo "installer rebuilt after ~$((i*10))s"; break
  fi
  n=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*build-desktop*' -or \$_.CommandLine -like '*electron-builder*' }).Count" 2>/dev/null | tr -d '\r\n ')
  if [ -n "$n" ] && [ "$n" = "0" ]; then
    echo "build process gone after ~$((i*10))s (installer mtime check: mt=$mt marker=$done_marker)"
    break
  fi
  sleep 10
done
echo "=== build log tail ==="
tail -12 /tmp/fullbuild.log
echo "=== installer ==="
ls -la "$EXE"