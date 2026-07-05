@echo off
title Stop Breadfast QA Platform
cd /d "%~dp0"
node "launcher\stop.mjs"
timeout /t 2 /nobreak >nul
