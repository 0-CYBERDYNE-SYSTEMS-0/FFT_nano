#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/start.sh dev [telegram-only]
  ./scripts/start.sh start [telegram-only]

Notes:
- Sources .env if present.
- telegram-only sets WHATSAPP_ENABLED=0.
USAGE
}

mode="${1:-}"
shift || true

if [[ -z "$mode" || "$mode" == "-h" || "$mode" == "--help" ]]; then
  usage
  exit 0
fi

# Load .env if present
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

for arg in "$@"; do
  if [[ "$arg" == "telegram-only" ]]; then
    export WHATSAPP_ENABLED=0
  fi
done

run_runtime_detect() {
  local raw="${CONTAINER_RUNTIME:-auto}"
  raw="${raw,,}"
  if [[ "$raw" == "apple" || "$raw" == "docker" ]]; then
    echo "$raw"; return
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && command -v container >/dev/null 2>&1; then
    echo "apple"; return
  fi
  if command -v docker >/dev/null 2>&1; then
    echo "docker"; return
  fi
  if command -v container >/dev/null 2>&1; then
    echo "apple"; return
  fi
  echo "unknown"
}

runtime="$(run_runtime_detect)"
telegram="${TELEGRAM_BOT_TOKEN:-}"
wa="${WHATSAPP_ENABLED:-1}"

echo "FFT_nano start (mode=$mode, runtime=$runtime, whatsapp=$wa, telegram=$([[ -n "$telegram" ]] && echo enabled || echo disabled))"

case "$mode" in
  dev)
    exec npm run dev
    ;;
  start)
    exec npm run start
    ;;
  *)
    usage
    exit 2
    ;;
esac
