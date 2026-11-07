#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

# New React workbench (codelens-prototype)
if [ ! -d codelens-prototype/node_modules ]; then
  echo "Installing frontend dependencies (first run only)..."
  (cd codelens-prototype && npm install)
fi
(cd codelens-prototype && npm run dev) &
echo "Backend API http://127.0.0.1:18766  |  UI http://localhost:5173/"

exec python3 -B code/backend/server.py "$@"
