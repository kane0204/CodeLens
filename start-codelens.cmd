@echo off
setlocal
cd /d "%~dp0"

rem --- New React workbench (codelens-prototype) ---
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

pushd "codelens-prototype"
start "CodeLens UI" /min cmd /c "npm run dev"
popd
timeout /t 2 >nul
start "" http://localhost:5173/

:backend
echo Backend API http://127.0.0.1:18766  ^|  UI http://localhost:5173/
python -B code/backend/server.py
pause
