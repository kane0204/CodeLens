#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -f "code/frontend/dist/index.html" ]; then
  npm run build
fi
exec python3 -B code/backend/server.py "$@"
