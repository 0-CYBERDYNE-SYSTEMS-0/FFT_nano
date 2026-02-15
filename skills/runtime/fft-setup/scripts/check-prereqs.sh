#!/usr/bin/env bash
set -euo pipefail

echo "[fft-setup] host=$(uname -s)"

if ! command -v node >/dev/null 2>&1; then
  echo "missing: node"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "missing: npm"
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" -lt 20 ]]; then
  echo "node must be >=20, found $(node -v)"
  exit 1
fi

runtime="none"
if [[ "$(uname -s)" == "Darwin" ]] && command -v container >/dev/null 2>&1; then
  runtime="apple"
elif command -v docker >/dev/null 2>&1; then
  runtime="docker"
elif command -v container >/dev/null 2>&1; then
  runtime="apple"
fi

if [[ "$runtime" == "none" ]]; then
  echo "no container runtime found (install Apple Container or Docker)"
  exit 1
fi

echo "node=$(node -v)"
echo "npm=$(npm -v)"
echo "runtime=$runtime"
if [[ "$runtime" == "docker" ]]; then
  docker --version || true
else
  container --version || true
fi

echo "[fft-setup] prereqs OK"
