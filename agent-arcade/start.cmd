@echo off
REM Agent Arcade launcher for Windows: double-click to start.
REM Installs dependencies the first time, starts server + client, and opens
REM the app in its own window (Microsoft Edge app mode; falls back to your
REM default browser). Close this console window to stop everything.
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause & exit /b 1
)
REM Pull the latest version if this is a git checkout and git is installed.
where git >nul 2>nul && (
  echo Checking for updates...
  git pull --ff-only
)
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm.cmd install || (pause & exit /b 1)
) else (
  call npm.cmd install --no-audit --no-fund >nul 2>nul
)
REM Stop any Agent Arcade server/client still running from an earlier window.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":8787 .*LISTENING"') do taskkill /f /pid %%p >nul 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":5173 .*LISTENING"') do taskkill /f /pid %%p >nul 2>nul
echo Starting Agent Arcade... keep this window open while you use it.
start "" /b cmd /c "timeout /t 5 >nul && (start msedge --app=http://127.0.0.1:5173 || start http://127.0.0.1:5173)"
call npm.cmd run dev
