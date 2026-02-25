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
if command -v docker >/dev/null 2>&1; then
  runtime="docker"
elif [[ "${CONTAINER_RUNTIME:-}" == "host" ]] && [[ "${FFT_NANO_ALLOW_HOST_RUNTIME:-}" == "1" ]]; then
  runtime="host"
fi

if [[ "$runtime" == "none" ]]; then
  echo "no supported runtime found (install Docker, or set CONTAINER_RUNTIME=host with FFT_NANO_ALLOW_HOST_RUNTIME=1)"
  exit 1
fi

echo "node=$(node -v)"
echo "npm=$(npm -v)"
echo "runtime=$runtime"
if [[ "$runtime" == "docker" ]]; then
  docker --version || true
else
  echo "host runtime requested (no container isolation)"
fi

echo "[fft-setup] prereqs OK"
