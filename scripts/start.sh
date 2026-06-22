#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/start.sh [start] [telegram-only]
  ./scripts/start.sh dev [telegram-only]
  ./scripts/start.sh tui [--url ws://127.0.0.1:28989] [--session main] [--deliver] [--no-open]
  ./scripts/start.sh web [--open]

Notes:
- Sources .env if present.
- Defaults to start mode when mode is omitted.
- telegram-only sets WHATSAPP_ENABLED=0.
- tui is attach-client mode. If the host is not running, it is started in
  the background first. The web control center is then opened in the default
  browser unless --no-open is passed.
USAGE
}

mode="start"
mode_set=0
telegram_only=0
tui_args=()
tui_open_browser=1
tui_no_open=0
web_args=()

while [[ $# -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    start|dev|tui|web)
      if [[ "$mode_set" -eq 1 ]]; then
        echo "ERROR: multiple modes supplied (use one of: start|dev|tui|web)" >&2
        usage
        exit 2
      fi
      mode="$arg"
      mode_set=1
      ;;
    telegram-only)
      telegram_only=1
      ;;
    --no-open)
      tui_no_open=1
      tui_open_browser=0
      shift
      continue
      ;;
    --open)
      tui_open_browser=1
      shift
      continue
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        if [[ "$mode" == "tui" ]]; then
          tui_args+=("$1")
        else
          web_args+=("$1")
        fi
        shift
      done
      break
      ;;
    *)
      if [[ "$mode" == "tui" ]]; then
        tui_args+=("$arg")
      elif [[ "$mode" == "web" ]]; then
        web_args+=("$arg")
      else
        echo "ERROR: unknown argument: $arg" >&2
        usage
        exit 2
      fi
      ;;
  esac
  shift
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

# Attached TUI gateway defaults.
# Allow explicit override (including disabling with 0/false/no).
export FFT_NANO_TUI_ENABLED="${FFT_NANO_TUI_ENABLED:-1}"
export FFT_NANO_TUI_HOST="${FFT_NANO_TUI_HOST:-127.0.0.1}"
export FFT_NANO_TUI_PORT="${FFT_NANO_TUI_PORT:-28989}"
export FFT_NANO_WEB_ENABLED="${FFT_NANO_WEB_ENABLED:-1}"
export FFT_NANO_WEB_ACCESS_MODE="${FFT_NANO_WEB_ACCESS_MODE:-localhost}"
export FFT_NANO_WEB_HOST="${FFT_NANO_WEB_HOST:-127.0.0.1}"
export FFT_NANO_WEB_PORT="${FFT_NANO_WEB_PORT:-28990}"

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
  if [[ "$raw" == "docker" || "$raw" == "host" ]]; then
    echo "$raw"; return
  fi
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "docker"; return
  fi
  echo "host"
}

runtime="$(run_runtime_detect)"
telegram="${TELEGRAM_BOT_TOKEN:-}"
wa="${WHATSAPP_ENABLED:-1}"
tui_enabled="${FFT_NANO_TUI_ENABLED:-1}"
tui_host="${FFT_NANO_TUI_HOST:-127.0.0.1}"
tui_port="${FFT_NANO_TUI_PORT:-28989}"
web_enabled="${FFT_NANO_WEB_ENABLED:-1}"
web_access="${FFT_NANO_WEB_ACCESS_MODE:-localhost}"
web_host="${FFT_NANO_WEB_HOST:-127.0.0.1}"
web_port="${FFT_NANO_WEB_PORT:-28990}"
profile="${FFT_PROFILE:-core}"
feature_farm="${FEATURE_FARM:-auto}"

echo "FFT_nano start (mode=$mode, profile=$profile, feature_farm=$feature_farm, runtime=$runtime, whatsapp=$wa, telegram=$([[ -n "$telegram" ]] && echo enabled || echo disabled), tui_enabled=$tui_enabled, tui_host=$tui_host, tui_port=$tui_port, web_enabled=$web_enabled, web_access=$web_access, web_host=$web_host, web_port=$web_port)"

# --- Host lifecycle helpers ------------------------------------------------
# Used by `tui` mode to bring the host up (or hand off cleanly if it's
# already running) and then open the web control center.

LOCK_FILE="$ROOT_DIR/data/fft_nano.lock"
READY_TIMEOUT_SECONDS="${FFT_NANO_READY_TIMEOUT_SECONDS:-30}"

host_pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_lock() {
  [[ -f "$LOCK_FILE" ]] || return 1
  node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(data.pid || ""));
    } catch {
      process.exit(1);
    }
  ' "$LOCK_FILE" 2>/dev/null
}

wait_for_host() {
  local waited=0
  while (( waited < READY_TIMEOUT_SECONDS )); do
    if curl -sS -o /dev/null --max-time 2 "${web_url}/api/health" 2>/dev/null; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

ensure_host_running() {
  local pid
  pid="$(read_lock || true)"
  if host_pid_alive "$pid"; then
    echo "FFT_nano host already running (PID $pid)."
    return 0
  fi
  # Stale lock file: remove it before starting fresh.
  [[ -f "$LOCK_FILE" ]] && rm -f "$LOCK_FILE" || true
  echo "Starting FFT_nano host in the background..."
  if [[ "$telegram_only" -eq 1 ]]; then
    ( cd "$ROOT_DIR" && WHATSAPP_ENABLED=0 nohup node bin/fft.js start >/dev/null 2>&1 & )
  else
    ( cd "$ROOT_DIR" && nohup node bin/fft.js start >/dev/null 2>&1 & )
  fi
  if wait_for_host; then
    echo "FFT_nano host is ready."
    return 0
  fi
  echo "ERROR: FFT_nano host did not become ready within ${READY_TIMEOUT_SECONDS}s." >&2
  return 1
}

open_webui() {
  [[ "$tui_open_browser" -eq 1 ]] || return 0
  [[ "$web_enabled" == "1" ]] || {
    echo "Web control center is disabled (FFT_NANO_WEB_ENABLED=0); skipping browser open."
    return 0
  }
  if command -v open >/dev/null 2>&1; then
    open "$web_url" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$web_url" >/dev/null 2>&1 || true
  else
    echo "Open the web control center at: $web_url"
  fi
}

web_url="http://${web_host}:${web_port}"
if [[ "$web_host" == "0.0.0.0" || "$web_host" == "::" ]]; then
  web_url="http://127.0.0.1:${web_port}"
fi

if [[ "$mode" == "dev" ]]; then
  echo "Note: dev mode is for debugging only; normal runtime should use start mode (or omit mode)." >&2
fi

case "$mode" in
  dev)
    exec npm run dev
    ;;
  tui)
    # Bring up the host if it isn't already running so the webui is available,
    # then open the control center in the default browser (unless --no-open).
    ensure_host_running
    open_webui
    if [[ "${#tui_args[@]}" -gt 0 ]]; then
      exec npm run tui -- "${tui_args[@]}"
    fi
    exec npm run tui
    ;;
  web)
    # Start the host (with webui) if it isn't already running, then point the
    # operator at the control center URL and open it in the default browser.
    ensure_host_running
    open_webui
    if [[ "${#web_args[@]}" -gt 0 ]]; then
      exec bash "$ROOT_DIR/scripts/web.sh" "${web_args[@]}"
    fi
    exec bash "$ROOT_DIR/scripts/web.sh"
    ;;
  start)
    exec npm run start
    ;;
  *)
    usage
    exit 2
    ;;
esac
