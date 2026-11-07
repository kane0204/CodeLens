#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

UIURL="http://localhost:5173/"

echo "============================================================"
echo "  CodeLens - React workbench"
echo "  OPEN THIS ADDRESS : $UIURL"
echo "  Backend API       : http://127.0.0.1:18766"
echo "  NOTE: the page on 18766 is the OLD HTML interface. Do not use it."
echo "============================================================"

# New React workbench (codelens-prototype)
if [ ! -d codelens-prototype/node_modules ]; then
  echo "Installing frontend dependencies (first run only)..."
  (cd codelens-prototype && npm install)
fi

# --strictPort: fail loudly instead of silently moving to 5174
(cd codelens-prototype && npm run dev -- --strictPort) &
UI_PID=$!
trap 'kill "$UI_PID" 2>/dev/null || true' EXIT INT TERM

i=0
while [ "$i" -lt 30 ]; do
  if command -v curl >/dev/null 2>&1 && curl -fsS -o /dev/null "$UIURL" 2>/dev/null; then
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

python3 -B code/backend/server.py "$@"
