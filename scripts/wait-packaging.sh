#!/usr/bin/env bash
# Polls until no electron-builder node process remains, then reports.
for i in $(seq 1 55); do
  n=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*electron-builder*' }).Count" 2>/dev/null | tr -d '\r\n ')
  if [ -z "$n" ] || [ "$n" = "0" ]; then
    echo "packaging finished after ~$((i*10))s"
    break
  fi
  sleep 10
done
echo "=== log tail ==="
tail -10 /tmp/nsis-pack.log 2>/dev/null
echo "=== installer ==="
ls -la dist-electron/*.exe
