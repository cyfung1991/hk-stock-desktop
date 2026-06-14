@echo off
cd /d "%~dp0"
echo Building HK Stock Desktop...
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Build failed. Make sure Node.js is installed on Windows.
  echo Install with: winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)
echo.
echo Done. Output: release\0.0.0\
pause
