@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Scalar.ps1"
exit /b %ERRORLEVEL%
