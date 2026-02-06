#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/Users/scrimwiggins/fft_nano"
NODE_BIN="/Users/scrimwiggins/.pocket-server/bin/node"
APP_ENTRY="$PROJECT_ROOT/dist/index.js"

cd "$PROJECT_ROOT"

# Load .env if present (used for pi runtime config; can also include TELEGRAM_BOT_TOKEN).
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

# Prefer TELEGRAM_BOT_TOKEN from .env, else fall back to macOS Keychain.
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  ACCOUNT="$(id -un 2>/dev/null || true)"
  if [[ -z "${ACCOUNT}" ]]; then
    ACCOUNT="scrimwiggins"
  fi
  TELEGRAM_BOT_TOKEN="$(security find-generic-password -a "${ACCOUNT}" -s "FFT_nano:TELEGRAM_BOT_TOKEN" -w 2>/dev/null || true)"
  export TELEGRAM_BOT_TOKEN
fi

# Default to Telegram-only unless overridden.
export WHATSAPP_ENABLED="${WHATSAPP_ENABLED:-0}"
export TELEGRAM_AUTO_REGISTER="${TELEGRAM_AUTO_REGISTER:-0}"

exec "$NODE_BIN" "$APP_ENTRY"
