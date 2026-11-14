@echo off
setlocal
cd /d "%~dp0"

set "UIURL=http://localhost:5173/"
set "APIURL=http://127.0.0.1:18766"

echo ============================================================
echo   CodeLens - React workbench
echo   OPEN THIS ADDRESS : %UIURL%
echo   Backend API       : %APIURL%
echo   NOTE: 18766 serves FastAPI and API docs. The UI is at 5173.
echo   Logs             : %CD%\logs\codelens.log
echo ============================================================
echo.

rem --- Warn when 18766 is already taken by another (old) backend ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort 18766 -State Listen -ErrorAction SilentlyContinue; if ($c) { Write-Host 'WARNING: port 18766 is already occupied by another backend process.'; Write-Host 'The new UI would talk to a different backend and AI review may fail.'; Write-Host 'Close the old server window first, then run this script again.'; }" 2>nul

set "BACKEND_PYTHON=%CD%\.venv\Scripts\python.exe"
if not exist "%BACKEND_PYTHON%" (
  python -m venv .venv
  if errorlevel 1 goto backend_setup_failed
)
"%BACKEND_PYTHON%" -c "import sys; sys.exit(sys.version_info < (3, 11))"
if errorlevel 1 (
  echo CodeLens requires Python 3.11 or later. Recreate .venv with a supported Python.
  goto backend_setup_failed
)
"%BACKEND_PYTHON%" -B code/backend/asgi.py --help >nul 2>&1
if errorlevel 1 (
  echo Installing backend dependencies...
  "%BACKEND_PYTHON%" -m pip install -r requirements-backend.txt
  if errorlevel 1 goto backend_setup_failed
  "%BACKEND_PYTHON%" -B code/backend/asgi.py --help >nul
  if errorlevel 1 goto backend_setup_failed
)

rem --- Install frontend dependencies on first run ---
if not exist "codelens-prototype\node_modules\vite" (
  echo Installing frontend dependencies ^(first run only^)...
  pushd "codelens-prototype"
  call npm install
  if errorlevel 1 (
    echo Frontend install failed; backend will still start. See README for manual setup.
    popd
    goto backend
  )
  popd
)

rem --- Start the React dev server; --strictPort fails loudly if 5173 is occupied ---
pushd "codelens-prototype"
start "CodeLens UI" /min cmd /c "npm run dev -- --strictPort"
popd

rem --- Check the UI and its API proxy while the backend starts below ---
start "" /b powershell -NoProfile -Command "$ok=$false; for($i=0; $i -lt 30; $i++){ try { $null=Invoke-WebRequest -UseBasicParsing -Uri '%UIURL%' -TimeoutSec 2; $api=Invoke-RestMethod -Uri '%UIURL%api/status' -TimeoutSec 2; if($api.ready){$ok=$true;break} } catch {}; Start-Sleep -Seconds 1 }; if($ok){ Start-Process '%UIURL%' -WindowStyle Normal } else { Write-Host 'WARNING: UI or API not ready; check the startup logs.' }"

:backend
echo.
echo Backend API %APIURL%  ^|  React UI %UIURL%
echo Keep this window open. Closing it stops the backend.
"%BACKEND_PYTHON%" -B code/backend/asgi.py
set "BACKEND_EXIT=%ERRORLEVEL%"
pause
exit /b %BACKEND_EXIT%

:backend_setup_failed
echo Backend setup failed. See the Python or pip error above.
pause
exit /b 1
