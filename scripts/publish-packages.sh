#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Syncing lockfile (workspace versions)..."
bun update

echo "Building libraries..."
bun run build:libs

# Publish in dependency order. bun publish rewrites workspace:* → semver automatically.
PACKAGES=(
  packages/protocol
  packages/persistence
  packages/tools
  packages/core
  packages/uploads
  packages/tools-fs
  packages/agent
  packages/server
  packages/react
  packages/ui
)

for dir in "${PACKAGES[@]}"; do
  name=$(node -p "require('./${dir}/package.json').name")
  echo "Publishing ${name}..."
  bun publish --cwd "$dir" --access public
done

echo "Done."
