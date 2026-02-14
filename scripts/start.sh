#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/start.sh [start] [telegram-only]
  ./scripts/start.sh dev [telegram-only]

Notes:
- Sources .env if present.
- Defaults to start mode when mode is omitted.
- telegram-only sets WHATSAPP_ENABLED=0.
USAGE
}

mode="start"
mode_set=0
telegram_only=0

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    start|dev)
      if [[ "$mode_set" -eq 1 ]]; then
        echo "ERROR: multiple modes supplied (use one of: start|dev)" >&2
        usage
        exit 2
      fi
      mode="$arg"
      mode_set=1
      ;;
    telegram-only)
      telegram_only=1
      ;;
    *)
      echo "ERROR: unknown argument: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

# Load .env if present
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [[ "$telegram_only" -eq 1 ]]; then
  export WHATSAPP_ENABLED=0
fi

# Prefer TELEGRAM_BOT_TOKEN from .env/exports; fall back to macOS Keychain.
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] && [[ "$(uname -s)" == "Darwin" ]] && command -v security >/dev/null 2>&1; then
  ACCOUNT="$(id -un 2>/dev/null || true)"
  if [[ -z "${ACCOUNT}" ]]; then
    ACCOUNT="$(whoami 2>/dev/null || true)"
  fi
  TELEGRAM_BOT_TOKEN="$(security find-generic-password -a "${ACCOUNT}" -s "FFT_nano:TELEGRAM_BOT_TOKEN" -w 2>/dev/null || true)"
  export TELEGRAM_BOT_TOKEN
fi

run_runtime_detect() {
  local raw="${CONTAINER_RUNTIME:-auto}"
  raw="$(printf %s "$raw" | tr '[:upper:]' '[:lower:]')"
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

if [[ "$mode" == "dev" ]]; then
  echo "Note: dev mode is for debugging only; normal runtime should use start mode (or omit mode)." >&2
fi

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
