#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Building libraries..."
bun run build:libs

PACKAGES=(
  @webacp/protocol
  @webacp/persistence
  @webacp/tools
  @webacp/core
  @webacp/uploads
  @webacp/tools-fs
  @webacp/agent
  @webacp/server
  @webacp/react
  @webacp/ui
)

for pkg in "${PACKAGES[@]}"; do
  echo "Publishing $pkg..."
  npm publish --workspace "$pkg" --access public
done

echo "Done."
