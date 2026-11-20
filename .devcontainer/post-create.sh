#!/usr/bin/env bash
set -euo pipefail

python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Set DATABASE_URL to a dedicated Neon development branch before starting CareX."
fi

echo
echo "CareX Codespace dependencies are installed."
echo "Start the API with: python -m carex.ops serve --host 0.0.0.0 --port 8127 --reload"
echo "CareX requires PostgreSQL/Neon; no SQLite or local-file database is provided."
