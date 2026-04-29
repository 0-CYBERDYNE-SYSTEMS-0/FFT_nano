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
  --runtime <runtime>       auto|docker|host
  --auth-choice <choice>    openai|lm-studio|anthropic|gemini|openrouter|zai|minimax|kimi-coding|ollama|skip
  --model <id>              Model id/provider model
  --api-key <token>         Provider API key for selected auth choice
  --remote-url <url>        Remote gateway URL (remote mode)
  --gateway-port <port>     Gateway/TUI port hint
  --telegram-token <token>       Telegram bot token
  --telegram-main-chat-id <id>   Pre-set Telegram main chat ID (skips /main claim)
  --whatsapp-enabled <0|1>       Enable WhatsApp channel toggle
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

Runtime note:
  setup.sh is the single runtime decision point. If Docker is unavailable and
  runtime is unresolved, setup prompts for host or docker during step 2.
USAGE
}

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

normalize_runtime() {
  local raw="${1:-}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    auto|docker|host) printf '%s' "$raw" ;;
    *) fail "Invalid --runtime (use auto|docker|host): $1" ;;
  esac
}

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
RUNTIME_ARG=""
AUTH_CHOICE_ARG=""
MODEL_ARG=""
API_KEY_ARG=""
REMOTE_URL_ARG=""
GATEWAY_PORT_ARG=""
TELEGRAM_TOKEN_ARG=""
TELEGRAM_MAIN_CHAT_ID_ARG=""
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
    --runtime)
      [[ $# -ge 2 ]] || fail "--runtime requires a value"
      RUNTIME_ARG="$(normalize_runtime "$2")"
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
    --telegram-main-chat-id)
      [[ $# -ge 2 ]] || fail "--telegram-main-chat-id requires a value"
      TELEGRAM_MAIN_CHAT_ID_ARG="$2"
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

upsert_env_value() {
  local key="$1"
  local value="${2-}"
  local tmp_file
  tmp_file="$(mktemp)"
  local replaced=0
  if [[ -f .env ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^[[:space:]]*# ]] || [[ "$line" != *"="* ]] || [[ -z "${line//[[:space:]]/}" ]]; then
        printf '%s\n' "$line" >>"$tmp_file"
        continue
      fi
      local current_key="${line%%=*}"
      current_key="${current_key#"${current_key%%[![:space:]]*}"}"
      current_key="${current_key%"${current_key##*[![:space:]]}"}"
      if [[ "$current_key" == "$key" ]]; then
        printf '%s=%s\n' "$key" "$value" >>"$tmp_file"
        replaced=1
      else
        printf '%s\n' "$line" >>"$tmp_file"
      fi
    done < .env
  fi
  if [[ "$replaced" -eq 0 ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$tmp_file"
  fi
  mv "$tmp_file" .env
}

is_placeholder() {
  local value="${1:-}"
  [[ -z "$value" || "$value" == "replace-me" || "$value" == "..." ]]
}

provider_env_key() {
  local provider="$1"
  case "$provider" in
    openai) printf '%s' "OPENAI_API_KEY" ;;
    anthropic) printf '%s' "ANTHROPIC_API_KEY" ;;
    gemini) printf '%s' "GEMINI_API_KEY" ;;
    openrouter) printf '%s' "OPENROUTER_API_KEY" ;;
    opencode-go) printf '%s' "OPENCODE_API_KEY" ;;
    zai) printf '%s' "ZAI_API_KEY" ;;
    *) printf '' ;;
  esac
}

is_provider_configured() {
  local provider model token_var token_value
  provider="$(read_env_value PI_API)"
  model="$(read_env_value PI_MODEL)"
  if is_placeholder "$provider" || is_placeholder "$model"; then
    return 1
  fi

  token_var="$(provider_env_key "$provider")"

  if [[ -n "$token_var" ]]; then
    token_value="$(read_env_value "$token_var")"
    if is_placeholder "$token_value"; then
      return 1
    fi
  fi
  return 0
}

is_telegram_token_configured() {
  local tg_token
  tg_token="$(read_env_value TELEGRAM_BOT_TOKEN)"
  if is_placeholder "$tg_token"; then
    return 1
  fi
  return 0
}

is_telegram_admin_secret_configured() {
  local secret
  secret="$(read_env_value TELEGRAM_ADMIN_SECRET)"
  if is_placeholder "$secret"; then
    return 1
  fi
  return 0
}

is_telegram_main_chat_env_configured() {
  local main_chat
  main_chat="$(read_env_value TELEGRAM_MAIN_CHAT_ID)"
  if is_placeholder "$main_chat"; then
    return 1
  fi
  return 0
}

has_registered_main_group() {
  local reg_path="${ROOT_DIR}/data/registered_groups.json"
  [[ -f "$reg_path" ]] || return 1
  node -e 'const fs=require("fs");
const p=process.argv[1];
try{
  const parsed=JSON.parse(fs.readFileSync(p,"utf8"));
  const hasMain=Object.values(parsed||{}).some((group)=>group&&group.folder==="main");
  process.exit(hasMain?0:1);
}catch{
  process.exit(1);
}' "$reg_path"
}

is_env_configured() {
  if ! is_provider_configured; then
    return 1
  fi
  if ! is_telegram_token_configured; then
    return 1
  fi
  return 0
}

launch_first_run_web_handoff() {
  say "[3/5] Launching first-run onboarding wizard..."
  upsert_env_value FFT_NANO_ONBOARDING_MODE 1
  if is_placeholder "$(read_env_value WHATSAPP_ENABLED)"; then
    upsert_env_value WHATSAPP_ENABLED 0
  fi
  say "      starting host in onboarding-only mode..."
  ./scripts/service.sh install
  ./scripts/service.sh restart
  sleep 1
  if ./scripts/web.sh --open; then
    :
  else
    ./scripts/web.sh
  fi
  say ""
  say "Continue setup in FFT CONTROL CENTER."
  say "Enter your provider/API key and Telegram bot token there."
  say "When you save, the host will restart with your Telegram bot active."
  say ""
  say "After restart, complete Telegram setup (required before the bot answers messages):"
  say "  1. DM your bot: /id              (get your numeric chat ID)"
  say "  2. DM your bot: /main <secret>   (bind this DM as the main chat)"
  say "  TUI fallback: ./scripts/start.sh tui"
  exit 0
}

is_service_running() {
  ./scripts/service.sh status >/dev/null 2>&1
}

print_readiness_line() {
  local label="$1"
  local status="$2"
  local detail="${3:-}"
  if [[ -n "$detail" ]]; then
    say "  - ${label}: ${status} (${detail})"
    return
  fi
  say "  - ${label}: ${status}"
}

print_numbered_list() {
  local title="$1"
  shift
  local -a items=("$@")
  say "${title}"
  if [[ "${#items[@]}" -eq 0 ]]; then
    say "  none"
    return
  fi
  local i=1
  for item in "${items[@]}"; do
    say "  ${i}) ${item}"
    ((i++))
  done
}

render_completion_handoff() {
  local install_daemon="$1"
  local service_state="$2"
  local runtime_pref="$3"

  local provider_status="FAIL"
  local telegram_token_status="FAIL"
  local admin_secret_status="FAIL"
  local main_chat_status="ACTION NEEDED"
  local service_status="SKIPPED"

  local provider_ready=0
  local telegram_token_ready=0
  local admin_secret_ready=0
  local main_chat_ready=0

  if is_provider_configured; then
    provider_ready=1
    provider_status="PASS"
  fi
  if is_telegram_token_configured; then
    telegram_token_ready=1
    telegram_token_status="PASS"
  fi
  if is_telegram_admin_secret_configured; then
    admin_secret_ready=1
    admin_secret_status="PASS"
  fi
  if is_telegram_main_chat_env_configured || has_registered_main_group; then
    main_chat_ready=1
    main_chat_status="PASS"
  fi

  if [[ "$install_daemon" == "1" ]]; then
    if [[ "$service_state" == "running" ]]; then
      service_status="PASS"
    else
      service_status="FAIL"
    fi
  else
    service_status="SKIPPED"
  fi

  local -a required_now=()
  local -a optional_next=()

  if [[ "$provider_ready" -eq 0 ]]; then
    required_now+=("Set PI_API/PI_MODEL/provider key in .env, then restart the service.")
  fi
  if [[ "$telegram_token_ready" -eq 0 ]]; then
    required_now+=("Set TELEGRAM_BOT_TOKEN in .env, then restart the service.")
  fi
  if [[ "$install_daemon" == "1" ]] && [[ "$service_state" != "running" ]]; then
    required_now+=("Run ./scripts/service.sh install && ./scripts/service.sh restart")
  fi
  if [[ "$telegram_token_ready" -eq 1 ]] && [[ "$main_chat_ready" -eq 0 ]]; then
    if [[ "$admin_secret_ready" -eq 1 ]]; then
      required_now+=("In Telegram DM with your bot: /id then /main <secret>")
    else
      required_now+=("Set TELEGRAM_ADMIN_SECRET in .env, restart service, then in Telegram DM run: /id then /main <secret>")
    fi
  fi

  optional_next+=("./scripts/profile.sh status")
  optional_next+=("./scripts/service.sh status")
  optional_next+=("./scripts/start.sh tui")

  say ""
  say "Onboarding flow complete."
  say ""
  say "Readiness checks:"
  print_readiness_line "AI provider config" "${provider_status}"
  print_readiness_line "Runtime preference" "${runtime_pref}"
  print_readiness_line "Telegram bot token" "${telegram_token_status}"
  print_readiness_line "Telegram admin secret" "${admin_secret_status}"
  if [[ "$install_daemon" == "1" ]]; then
    print_readiness_line "Service running" "${service_status}"
  else
    print_readiness_line "Service running" "${service_status}" "--no-install-daemon"
  fi
  print_readiness_line "Main/admin chat claimed" "${main_chat_status}"
  say ""

  if [[ -z "${required_now[*]-}" ]]; then
    say "Required now:"
    say "  (none)"
  else
    print_numbered_list "Required now:" "${required_now[@]}"
  fi
  say ""
  if [[ -z "${required_now[*]-}" ]]; then
    say "ONBOARDING COMPLETE: READY"
  else
    say "ONBOARDING COMPLETE: USER ACTION REQUIRED"
  fi
  say ""
  print_numbered_list "Optional next:" "${optional_next[@]}"
}

say "FFT_nano onboard (single command)"
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
  setup_args=()
  if [[ -n "$RUNTIME_ARG" ]]; then
    setup_args+=(--runtime "$RUNTIME_ARG")
  fi
  setup_env=(FFT_NANO_AUTO_SERVICE=0)
  if [[ "$RUNTIME_ARG" == "host" ]]; then
    # Runtime choice in onboarding is explicit user opt-in for host mode.
    setup_env+=(FFT_NANO_ALLOW_HOST_RUNTIME=1)
  fi
  if [[ -n "$RUNTIME_ARG" ]]; then
    env "${setup_env[@]}" ./scripts/setup.sh "${setup_args[@]}"
  else
    env "${setup_env[@]}" ./scripts/setup.sh
  fi
  persisted_runtime="$(read_env_value CONTAINER_RUNTIME)"
  if ! is_placeholder "$persisted_runtime"; then
    RUNTIME_ARG="$(normalize_runtime "$persisted_runtime")"
  fi
else
  say "[2/5] Skipping setup (--skip-setup)"
fi

if ! is_env_configured; then
  launch_first_run_web_handoff
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
if [[ -n "$RUNTIME_ARG" ]]; then
  onboard_args+=(--runtime "$RUNTIME_ARG")
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
if [[ -n "$TELEGRAM_MAIN_CHAT_ID_ARG" ]]; then
  onboard_args+=(--telegram-main-chat-id "$TELEGRAM_MAIN_CHAT_ID_ARG")
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
  install_choice="$(printf '%s' "$install_choice" | tr '[:upper:]' '[:lower:]')"
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

service_state="skipped"
if [[ "$INSTALL_DAEMON" == "1" ]]; then
  if is_service_running; then
    service_state="running"
  else
    service_state="not_running"
  fi
fi

runtime_pref="$RUNTIME_ARG"
if [[ -z "$runtime_pref" ]]; then
  runtime_pref="$(read_env_value CONTAINER_RUNTIME)"
  if is_placeholder "$runtime_pref"; then
    runtime_pref="auto"
  fi
fi

render_completion_handoff "$INSTALL_DAEMON" "$service_state" "$runtime_pref"
