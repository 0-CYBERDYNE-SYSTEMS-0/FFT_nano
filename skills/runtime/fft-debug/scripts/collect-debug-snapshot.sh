#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

echo "# fft-debug snapshot"
echo "generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "## git status"
git status --short || true
echo

echo "## lock"
ls -la data/fft_nano.lock 2>/dev/null || echo "no lock file"
echo

echo "## registered groups"
cat data/registered_groups.json 2>/dev/null || echo "missing data/registered_groups.json"
echo

echo "## router state"
cat data/router_state.json 2>/dev/null || echo "missing data/router_state.json"
echo

echo "## host logs (tail)"
tail -n 100 logs/fft_nano.log 2>/dev/null || echo "missing logs/fft_nano.log"
tail -n 100 logs/fft_nano.error.log 2>/dev/null || echo "missing logs/fft_nano.error.log"
echo

echo "## group logs"
find groups -maxdepth 3 -type f -path '*/logs/*' -print 2>/dev/null || true
