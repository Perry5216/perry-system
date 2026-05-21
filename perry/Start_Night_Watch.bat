@echo off
title Perry Night Watch
color 0A

echo =======================================================
echo   P.E.R.R.Y. NIGHT WATCH AUTO-PROMPTER
echo =======================================================
echo.
echo IMPORTANT: 
echo 1. Click your cursor into the Antigravity chat box NOW.
echo 2. Leave your PC on (Do not let it sleep or lock).
echo.
echo Waiting 10 seconds to give you time to click the chat box...
timeout /t 10

powershell.exe -ExecutionPolicy Bypass -File "%~dp0night_watch.ps1"
