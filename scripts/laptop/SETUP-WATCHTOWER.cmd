@echo off
rem Double-click on the LAPTOP. Installs tools, signs in to GitHub, clones WATCHTOWER and restores private files.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-laptop.ps1"
pause
