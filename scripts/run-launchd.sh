#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${FFT_NANO_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_ENTRY="$PROJECT_ROOT/dist/index.js"

cd "$PROJECT_ROOT"

# Load .env if present (used for pi runtime config; can also include TELEGRAM_BOT_TOKEN).
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

resolve_node_bin() {
  if [[ -n "${NODE_BIN:-}" ]]; then
    printf '%s\n' "$NODE_BIN"
    return
  fi

  # launchd does not load interactive shell profiles; resolve node from login shell first.
  local login_shell login_node
  login_shell="${SHELL:-/bin/zsh}"
  if [[ -x "$login_shell" ]]; then
    login_node="$("$login_shell" -lc 'command -v node' 2>/dev/null || true)"
    if [[ -n "$login_node" ]]; then
      printf '%s\n' "$login_node"
      return
    fi
  fi

  command -v node || true
}

NODE_BIN="$(resolve_node_bin)"
if [[ -z "${NODE_BIN}" ]]; then
  echo "node binary not found in PATH/login shell; set NODE_BIN explicitly" >&2
  exit 1
fi

# Prefer TELEGRAM_BOT_TOKEN from .env, else fall back to macOS Keychain.
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  ACCOUNT="$(id -un 2>/dev/null || true)"
  if [[ -z "${ACCOUNT}" ]]; then
    ACCOUNT="${USER:-local-user}"
  fi
  TELEGRAM_BOT_TOKEN="$(security find-generic-password -a "${ACCOUNT}" -s "FFT_nano:TELEGRAM_BOT_TOKEN" -w 2>/dev/null || true)"
  export TELEGRAM_BOT_TOKEN
fi

# Default to Telegram-only unless overridden.
export WHATSAPP_ENABLED="${WHATSAPP_ENABLED:-0}"
export TELEGRAM_AUTO_REGISTER="${TELEGRAM_AUTO_REGISTER:-0}"

# Attached TUI gateway defaults (overridable via launchd/env).
export FFT_NANO_TUI_ENABLED="${FFT_NANO_TUI_ENABLED:-1}"
export FFT_NANO_TUI_PORT="${FFT_NANO_TUI_PORT:-28989}"

exec "$NODE_BIN" "$APP_ENTRY"
