#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/onboard-all.sh [options]

Options:
  --workspace <dir>         Main workspace path (default: FFT_NANO_MAIN_WORKSPACE_DIR or ~/nano)
  --operator <name>         Primary operator name (passed to onboard)
  --assistant-name <name>   Assistant name (passed to onboard)
  --non-interactive         Require explicit operator/assistant-name values
  --force                   Force rewrite of onboarding identity files
  --skip-setup              Skip setup step (deps/build/image/service install)
  --skip-restart            Skip service restart after onboarding
  --skip-doctor             Skip doctor check at end
  --no-backup               Skip backup step
  --backup-out-dir <dir>    Backup output directory
  -h, --help                Show this help

This is the one-command onboarding flow:
  backup -> setup -> onboard identity -> service restart -> doctor
USAGE
}

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

WORKSPACE_DIR="${FFT_NANO_MAIN_WORKSPACE_DIR:-$HOME/nano}"
OPERATOR_NAME=""
ASSISTANT_NAME_ARG=""
NON_INTERACTIVE=0
FORCE=0
SKIP_SETUP=0
SKIP_RESTART=0
SKIP_DOCTOR=0
NO_BACKUP=0
BACKUP_OUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      [[ $# -ge 2 ]] || fail "--workspace requires a value"
      WORKSPACE_DIR="$2"
      shift 2
      ;;
    --operator)
      [[ $# -ge 2 ]] || fail "--operator requires a value"
      OPERATOR_NAME="$2"
      shift 2
      ;;
    --assistant-name)
      [[ $# -ge 2 ]] || fail "--assistant-name requires a value"
      ASSISTANT_NAME_ARG="$2"
      shift 2
      ;;
    --non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --skip-setup)
      SKIP_SETUP=1
      shift
      ;;
    --skip-restart)
      SKIP_RESTART=1
      shift
      ;;
    --skip-doctor)
      SKIP_DOCTOR=1
      shift
      ;;
    --no-backup)
      NO_BACKUP=1
      shift
      ;;
    --backup-out-dir)
      [[ $# -ge 2 ]] || fail "--backup-out-dir requires a value"
      BACKUP_OUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

read_env_value() {
  local key="$1"
  if [[ ! -f .env ]]; then
    return
  fi
  local value
  value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

is_placeholder() {
  local value="${1:-}"
  [[ -z "$value" || "$value" == "replace-me" || "$value" == "..." ]]
}

is_env_configured() {
  local provider model token_var token_value
  provider="$(read_env_value PI_API)"
  model="$(read_env_value PI_MODEL)"
  if is_placeholder "$provider" || is_placeholder "$model"; then
    return 1
  fi

  case "$provider" in
    openai) token_var="OPENAI_API_KEY" ;;
    anthropic) token_var="ANTHROPIC_API_KEY" ;;
    gemini) token_var="GEMINI_API_KEY" ;;
    openrouter) token_var="OPENROUTER_API_KEY" ;;
    zai) token_var="ZAI_API_KEY" ;;
    *) token_var="" ;;
  esac

  if [[ -n "$token_var" ]]; then
    token_value="$(read_env_value "$token_var")"
    if is_placeholder "$token_value"; then
      return 1
    fi
  fi

  local tg_token
  tg_token="$(read_env_value TELEGRAM_BOT_TOKEN)"
  if is_placeholder "$tg_token"; then
    return 1
  fi

  return 0
}

say "FFT_nano onboard (OpenClaw-style single command)"
say "Root: $ROOT_DIR"
say "Workspace: $WORKSPACE_DIR"
say ""

if [[ "$NO_BACKUP" -eq 0 ]]; then
  say "[1/5] Creating safety backup..."
  backup_args=(--workspace "$WORKSPACE_DIR")
  if [[ -n "$BACKUP_OUT_DIR" ]]; then
    backup_args+=(--out-dir "$BACKUP_OUT_DIR")
  fi
  npm run backup:state -- "${backup_args[@]}"
else
  say "[1/5] Skipping backup (--no-backup)"
fi

if [[ "$SKIP_SETUP" -eq 0 ]]; then
  say "[2/5] Running setup (deps/build/image/service)..."
  ./scripts/setup.sh
else
  say "[2/5] Skipping setup (--skip-setup)"
fi

if ! is_env_configured; then
  say "[env] .env appears incomplete (provider/model/key/telegram token)."
  say "Edit .env now, then continue."
  if [[ -t 0 ]]; then
    read -r -p "Press Enter to continue after updating .env, or Ctrl+C to abort... " _
  fi
fi

say "[3/5] Running onboarding..."
onboard_args=(--workspace "$WORKSPACE_DIR")
if [[ -n "$OPERATOR_NAME" ]]; then
  onboard_args+=(--operator "$OPERATOR_NAME")
fi
if [[ -n "$ASSISTANT_NAME_ARG" ]]; then
  onboard_args+=(--assistant-name "$ASSISTANT_NAME_ARG")
fi
if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
  onboard_args+=(--non-interactive)
fi
if [[ "$FORCE" -eq 1 ]]; then
  onboard_args+=(--force)
fi
./scripts/onboard.sh "${onboard_args[@]}"

if [[ "$SKIP_RESTART" -eq 0 ]]; then
  say "[4/5] Restarting service..."
  ./scripts/service.sh restart
else
  say "[4/5] Skipping restart (--skip-restart)"
fi

if [[ "$SKIP_DOCTOR" -eq 0 ]]; then
  say "[5/5] Running doctor..."
  npm run doctor -- --json
else
  say "[5/5] Skipping doctor (--skip-doctor)"
fi

say ""
say "Onboarding flow complete."
say "Next:"
say "  1) ./scripts/service.sh status"
say "  2) ./scripts/start.sh tui"
say "  3) In Telegram DM: /id then /main <secret>"
