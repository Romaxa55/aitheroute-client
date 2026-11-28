@echo off
setlocal
rem AI The Route: double-click to set up Claude Code with your own subscription (Windows).
rem The work is in start.ps1 beside this file; Bypass applies to that one run only.
if not exist "%~dp0start.ps1" (
  echo AI The Route: unpack the whole archive first ^(Extract All^), then run start.cmd from that folder.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set AITR_CODE=%errorlevel%
rem Double-clicked, the window stays open to be read; typed with arguments, it does not wait.
if "%~1"=="" pause
exit /b %AITR_CODE%
