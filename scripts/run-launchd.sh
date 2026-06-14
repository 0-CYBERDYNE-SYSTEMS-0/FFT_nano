#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${FFT_NANO_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_ENTRY="$PROJECT_ROOT/dist/index.js"

cd "$PROJECT_ROOT"

# launchd starts with a minimal PATH that often omits Docker/Homebrew locations.
login_shell="${SHELL:-/bin/zsh}"
if [[ -x "$login_shell" ]]; then
  login_path="$("$login_shell" -lc 'printf %s "$PATH"' 2>/dev/null || true)"
  if [[ -n "$login_path" ]]; then
    export PATH="$login_path:$PATH"
  fi
fi
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

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
export FFT_NANO_TUI_HOST="${FFT_NANO_TUI_HOST:-127.0.0.1}"
export FFT_NANO_TUI_PORT="${FFT_NANO_TUI_PORT:-28989}"
export FFT_NANO_WEB_ENABLED="${FFT_NANO_WEB_ENABLED:-1}"
export FFT_NANO_WEB_ACCESS_MODE="${FFT_NANO_WEB_ACCESS_MODE:-localhost}"
export FFT_NANO_WEB_HOST="${FFT_NANO_WEB_HOST:-127.0.0.1}"
export FFT_NANO_WEB_PORT="${FFT_NANO_WEB_PORT:-28990}"

# Install-recovery: if an `/update` died mid dependency-install/build (the
# window where node_modules is wiped by `npm ci` and dist/ may be stale), a
# marker file at data/update-incomplete survives. Finish the install + build
# here — before launching node — so a half-installed checkout self-heals
# instead of crash-looping silently. Roll back to the recorded pre-update SHA
# if the new code still won't build. All output goes to a recovery log.
recover_incomplete_update() {
  local marker="$PROJECT_ROOT/data/update-incomplete"
  [[ -f "$marker" ]] || return 0

  local recovery_log="$LOG_DIR/update-recovery.log"
  mkdir -p "$LOG_DIR"

  # Single-flight: claim the marker by renaming it. A concurrent launch that
  # loses the race skips recovery and lets the winner finish.
  local claim="$marker.recovering"
  if ! mv "$marker" "$claim" 2>/dev/null; then
    return 0
  fi

  local pre_sha
  pre_sha="$(head -1 "$claim" 2>/dev/null || true)"

  {
    echo "[$(date -u +%FT%TZ)] update-incomplete detected; finishing install (pre_sha=${pre_sha:-unknown})"
    if npm ci --include=dev && npm run build; then
      echo "[$(date -u +%FT%TZ)] recovery: reinstall + build OK"
      rm -f "$claim"
    elif [[ -n "$pre_sha" ]] && git reset --hard "$pre_sha" && npm ci --include=dev && npm run build; then
      echo "[$(date -u +%FT%TZ)] recovery: rolled back to $pre_sha and rebuilt OK"
      rm -f "$claim"
    else
      echo "[$(date -u +%FT%TZ)] recovery: FAILED; leaving marker for next boot. Manual fix: cd $PROJECT_ROOT && npm ci && npm run build"
      mv "$claim" "$marker" 2>/dev/null || true
    fi
  } >>"$recovery_log" 2>&1
}

LOG_DIR="${LOG_DIR:-$PROJECT_ROOT/logs}"
recover_incomplete_update

exec "$NODE_BIN" "$APP_ENTRY"
