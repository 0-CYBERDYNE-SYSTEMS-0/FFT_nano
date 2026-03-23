#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Verify working tree is clean
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Install dependencies if needed
if [[ ! -d "node_modules" ]]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Environment ready."
