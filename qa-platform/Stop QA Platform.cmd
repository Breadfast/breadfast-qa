@echo off
title Stop Breadfast QA Platform
echo Stopping Breadfast QA Platform (ports 3000 and 4000)...
powershell -NoProfile -Command "foreach($p in 3000,4000){Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { try{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop; Write-Host ('stopped pid '+$_.OwningProcess+' on '+$p) }catch{} }}"
echo Done.
timeout /t 2 /nobreak >nul
