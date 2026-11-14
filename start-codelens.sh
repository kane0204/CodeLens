#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

UIURL="http://localhost:5173/"

echo "============================================================"
echo "  CodeLens - React workbench"
echo "  OPEN THIS ADDRESS : $UIURL"
echo "  Backend API       : http://127.0.0.1:18766"
echo "  NOTE: 18766 serves FastAPI and API docs. The UI is at 5173."
echo "  Logs             : $(pwd)/logs/codelens.log"
echo "============================================================"

BACKEND_PYTHON=".venv/bin/python"
if [ ! -x "$BACKEND_PYTHON" ]; then
  python3 -m venv .venv
fi
if ! "$BACKEND_PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then
  echo "CodeLens requires Python 3.11 or later. Recreate .venv with a supported Python." >&2
  exit 1
fi
if ! "$BACKEND_PYTHON" -B code/backend/asgi.py --help >/dev/null 2>&1; then
  echo "Installing backend dependencies..."
  "$BACKEND_PYTHON" -m pip install -r requirements-backend.txt
  "$BACKEND_PYTHON" -B code/backend/asgi.py --help >/dev/null
fi

# New React workbench (codelens-prototype)
if [ ! -d codelens-prototype/node_modules ]; then
  echo "Installing frontend dependencies (first run only)..."
  (cd codelens-prototype && npm install)
fi

# --strictPort: fail loudly instead of silently moving to 5174
(cd codelens-prototype && npm run dev -- --strictPort) &
UI_PID=$!
"$BACKEND_PYTHON" -B code/backend/asgi.py "$@" &
API_PID=$!
trap 'kill "$UI_PID" "$API_PID" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

i=0
while [ "$i" -lt 30 ] && kill -0 "$API_PID" 2>/dev/null; do
  if command -v curl >/dev/null 2>&1 &&
      curl -fsS --max-time 2 -o /dev/null "${UIURL}api/status" 2>/dev/null; then
    echo "React workbench is ready at $UIURL"
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$UIURL" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
      open "$UIURL" >/dev/null 2>&1 || true
    fi
    break
  fi
  i=$((i + 1))
  sleep 1
done

wait "$API_PID"
