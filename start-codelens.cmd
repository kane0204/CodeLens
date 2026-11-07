@echo off
setlocal
cd /d "%~dp0"

set "UIURL=http://localhost:5173/"
set "APIURL=http://127.0.0.1:18766"

echo ============================================================
echo   CodeLens - React workbench
echo   OPEN THIS ADDRESS : %UIURL%
echo   Backend API       : %APIURL%
echo   NOTE: 18766 serves JSON API only. The UI is at 5173.
echo   Logs             : %CD%\logs\codelens.log
echo ============================================================
echo.

rem --- Warn when 18766 is already taken by another (old) backend ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort 18766 -State Listen -ErrorAction SilentlyContinue; if ($c) { Write-Host 'WARNING: port 18766 is already occupied by another backend process.'; Write-Host 'The new UI would talk to a different backend and AI review may fail.'; Write-Host 'Close the old server window first, then run this script again.'; }" 2>nul

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

rem --- Wait for the UI to answer before opening the browser ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0; $i -lt 60; $i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173/' -TimeoutSec 2; if($r.StatusCode -eq 200){$ok=$true;break} } catch {}; Start-Sleep -Seconds 1 }; if($ok){ Start-Process 'http://localhost:5173/'; Write-Host 'React workbench is ready at http://localhost:5173/' } else { Write-Host 'WARNING: React dev server did not start; check the CodeLens UI window.' }"

:backend
echo.
echo Backend API %APIURL%  ^|  React UI %UIURL%
echo Keep this window open. Closing it stops the backend.
python -B code/backend/server.py
pause
