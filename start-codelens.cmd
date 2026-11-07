@echo off
cd /d "%~dp0"
if not exist "code\frontend\dist\index.html" (
  echo Building the CodeLens React frontend...
  call npm run build
  if errorlevel 1 (
    echo Frontend build failed.
    pause
    exit /b 1
  )
)
python -B code/backend/server.py
pause
