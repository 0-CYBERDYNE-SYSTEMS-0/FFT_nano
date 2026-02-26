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
  --env-path <file>         Env file path passed to onboarding wizard
  --operator <name>         Primary operator name (passed to onboard)
  --assistant-name <name>   Assistant name (passed to onboard)
  --accept-risk             Pass explicit risk acknowledgement to onboarding
  --flow <flow>             quickstart|advanced|manual
  --mode <mode>             local|remote
  --auth-choice <choice>    openai|anthropic|gemini|openrouter|zai|skip
  --model <id>              Model id/provider model
  --api-key <token>         Provider API key for selected auth choice
  --remote-url <url>        Remote gateway URL (remote mode)
  --gateway-port <port>     Gateway/TUI port hint
  --telegram-token <token>  Telegram bot token
  --whatsapp-enabled <0|1>  Enable WhatsApp channel toggle
  --install-daemon          Install/start service after onboarding
  --no-install-daemon       Skip service install/start
  --hatch <choice>          tui|web|later
  --skip-channels           Skip channel prompts in onboarding wizard
  --skip-skills             Skip skills prompts in onboarding wizard
  --skip-health             Skip health prompts/checks
  --skip-ui                 Skip hatch prompts
  --non-interactive         Require explicit operator/assistant-name values
  --force                   Force rewrite of onboarding identity files
  --skip-setup              Skip setup step (deps/build/image/service install)
  --skip-restart            Skip service restart after onboarding
  --skip-doctor             Skip doctor check at end
  --no-backup               Skip backup step
  --backup-out-dir <dir>    Backup output directory
  -h, --help                Show this help

This is the one-command onboarding flow:
  backup -> setup -> onboarding wizard -> service step -> doctor
USAGE
}

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

WORKSPACE_DIR="${FFT_NANO_MAIN_WORKSPACE_DIR:-$HOME/nano}"
ENV_PATH_ARG=""
OPERATOR_NAME=""
ASSISTANT_NAME_ARG=""
NON_INTERACTIVE=0
FORCE=0
SKIP_SETUP=0
SKIP_RESTART=0
SKIP_DOCTOR=0
NO_BACKUP=0
BACKUP_OUT_DIR=""
ACCEPT_RISK=0
FLOW_ARG=""
MODE_ARG=""
AUTH_CHOICE_ARG=""
MODEL_ARG=""
API_KEY_ARG=""
REMOTE_URL_ARG=""
GATEWAY_PORT_ARG=""
TELEGRAM_TOKEN_ARG=""
WHATSAPP_ENABLED_ARG=""
HATCH_ARG=""
SKIP_CHANNELS=0
SKIP_SKILLS=0
SKIP_HEALTH=0
SKIP_UI=0
INSTALL_DAEMON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      [[ $# -ge 2 ]] || fail "--workspace requires a value"
      WORKSPACE_DIR="$2"
      shift 2
      ;;
    --env-path)
      [[ $# -ge 2 ]] || fail "--env-path requires a value"
      ENV_PATH_ARG="$2"
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
    --accept-risk)
      ACCEPT_RISK=1
      shift
      ;;
    --flow)
      [[ $# -ge 2 ]] || fail "--flow requires a value"
      FLOW_ARG="$2"
      shift 2
      ;;
    --mode)
      [[ $# -ge 2 ]] || fail "--mode requires a value"
      MODE_ARG="$2"
      shift 2
      ;;
    --auth-choice)
      [[ $# -ge 2 ]] || fail "--auth-choice requires a value"
      AUTH_CHOICE_ARG="$2"
      shift 2
      ;;
    --model)
      [[ $# -ge 2 ]] || fail "--model requires a value"
      MODEL_ARG="$2"
      shift 2
      ;;
    --api-key)
      [[ $# -ge 2 ]] || fail "--api-key requires a value"
      API_KEY_ARG="$2"
      shift 2
      ;;
    --remote-url)
      [[ $# -ge 2 ]] || fail "--remote-url requires a value"
      REMOTE_URL_ARG="$2"
      shift 2
      ;;
    --gateway-port)
      [[ $# -ge 2 ]] || fail "--gateway-port requires a value"
      GATEWAY_PORT_ARG="$2"
      shift 2
      ;;
    --telegram-token)
      [[ $# -ge 2 ]] || fail "--telegram-token requires a value"
      TELEGRAM_TOKEN_ARG="$2"
      shift 2
      ;;
    --whatsapp-enabled)
      [[ $# -ge 2 ]] || fail "--whatsapp-enabled requires a value"
      WHATSAPP_ENABLED_ARG="$2"
      shift 2
      ;;
    --install-daemon)
      INSTALL_DAEMON="1"
      shift
      ;;
    --no-install-daemon)
      INSTALL_DAEMON="0"
      shift
      ;;
    --hatch)
      [[ $# -ge 2 ]] || fail "--hatch requires a value"
      HATCH_ARG="$2"
      shift 2
      ;;
    --skip-channels)
      SKIP_CHANNELS=1
      shift
      ;;
    --skip-skills)
      SKIP_SKILLS=1
      shift
      ;;
    --skip-health)
      SKIP_HEALTH=1
      shift
      ;;
    --skip-ui)
      SKIP_UI=1
      shift
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
  FFT_NANO_AUTO_SERVICE=0 ./scripts/setup.sh
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
if [[ -n "$ENV_PATH_ARG" ]]; then
  onboard_args+=(--env-path "$ENV_PATH_ARG")
fi
if [[ -n "$OPERATOR_NAME" ]]; then
  onboard_args+=(--operator "$OPERATOR_NAME")
fi
if [[ -n "$ASSISTANT_NAME_ARG" ]]; then
  onboard_args+=(--assistant-name "$ASSISTANT_NAME_ARG")
fi
if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
  onboard_args+=(--non-interactive)
fi
if [[ "$ACCEPT_RISK" -eq 1 ]]; then
  onboard_args+=(--accept-risk)
fi
if [[ "$FORCE" -eq 1 ]]; then
  onboard_args+=(--force)
fi
if [[ -n "$FLOW_ARG" ]]; then
  onboard_args+=(--flow "$FLOW_ARG")
fi
if [[ -n "$MODE_ARG" ]]; then
  onboard_args+=(--mode "$MODE_ARG")
fi
if [[ -n "$AUTH_CHOICE_ARG" ]]; then
  onboard_args+=(--auth-choice "$AUTH_CHOICE_ARG")
fi
if [[ -n "$MODEL_ARG" ]]; then
  onboard_args+=(--model "$MODEL_ARG")
fi
if [[ -n "$API_KEY_ARG" ]]; then
  onboard_args+=(--api-key "$API_KEY_ARG")
fi
if [[ -n "$REMOTE_URL_ARG" ]]; then
  onboard_args+=(--remote-url "$REMOTE_URL_ARG")
fi
if [[ -n "$GATEWAY_PORT_ARG" ]]; then
  onboard_args+=(--gateway-port "$GATEWAY_PORT_ARG")
fi
if [[ -n "$TELEGRAM_TOKEN_ARG" ]]; then
  onboard_args+=(--telegram-token "$TELEGRAM_TOKEN_ARG")
fi
if [[ -n "$WHATSAPP_ENABLED_ARG" ]]; then
  onboard_args+=(--whatsapp-enabled "$WHATSAPP_ENABLED_ARG")
fi
if [[ -n "$HATCH_ARG" ]]; then
  onboard_args+=(--hatch "$HATCH_ARG")
fi
if [[ "$SKIP_CHANNELS" -eq 1 ]]; then
  onboard_args+=(--skip-channels)
fi
if [[ "$SKIP_SKILLS" -eq 1 ]]; then
  onboard_args+=(--skip-skills)
fi
if [[ "$SKIP_HEALTH" -eq 1 ]]; then
  onboard_args+=(--skip-health)
fi
if [[ "$SKIP_UI" -eq 1 ]]; then
  onboard_args+=(--skip-ui)
fi
if [[ -n "$INSTALL_DAEMON" ]]; then
  if [[ "$INSTALL_DAEMON" == "1" ]]; then
    onboard_args+=(--install-daemon)
  else
    onboard_args+=(--no-install-daemon)
  fi
fi
./scripts/onboard.sh "${onboard_args[@]}"

if [[ -z "$INSTALL_DAEMON" ]] && [[ -t 0 ]]; then
  read -r -p "Install/start host service now? [Y/n]: " install_choice
  install_choice="${install_choice,,}"
  if [[ -z "$install_choice" || "$install_choice" == "y" || "$install_choice" == "yes" ]]; then
    INSTALL_DAEMON="1"
  else
    INSTALL_DAEMON="0"
  fi
fi
if [[ -z "$INSTALL_DAEMON" ]]; then
  INSTALL_DAEMON="1"
fi

if [[ "$INSTALL_DAEMON" == "1" ]]; then
  say "[4/5] Ensuring service is installed and running..."
  ./scripts/service.sh install
  if [[ "$SKIP_RESTART" -eq 0 ]]; then
    ./scripts/service.sh restart
  else
    say "      restart skipped (--skip-restart)"
  fi
else
  say "[4/5] Skipping service install/start (--no-install-daemon)"
fi

if [[ "$SKIP_DOCTOR" -eq 0 ]] && [[ "$SKIP_HEALTH" -eq 0 ]]; then
  say "[5/5] Running doctor..."
  npm run doctor -- --json
else
  say "[5/5] Skipping doctor (--skip-doctor/--skip-health)"
fi

say ""
say "Onboarding flow complete."
say "Next:"
say "  1) ./scripts/profile.sh status"
say "  2) ./scripts/service.sh status"
say "  3) ./scripts/web.sh"
say "  4) ./scripts/start.sh tui"
say "  5) In Telegram DM: /id then /main <secret>"
