@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron runtime is missing. Run npm install and node node_modules/electron/install.js first.
  pause
  exit /b 1
)
if not exist "out\main\index.js" (
  call npm.cmd run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "PD Impression" "node_modules\electron\dist\electron.exe" "out\main\index.js"
