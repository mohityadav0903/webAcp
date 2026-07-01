#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="$ROOT/apps/local-agent/src/index.ts"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required: https://bun.sh"
  exit 1
fi

echo "Installing webacp-agent (bin + background service)..."
exec bun run "$ENTRY" install
