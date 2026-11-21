@echo off
rem Double-click on the DESKTOP. Makes the WATCHTOWER-to-laptop folder (on a USB stick if one is plugged in).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-for-laptop.ps1"
pause
