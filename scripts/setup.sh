#!/usr/bin/env bash
set -euo pipefail

# One-time setup helper for FFT_nano.
# - Installs Node deps
# - Builds TypeScript
# - Builds the agent container image
# - Scaffolds .env (template) and mount allowlist

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

say() { printf "%s\n" "$*"; }
fail() { printf "\nERROR: %s\n" "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/setup.sh [--runtime auto|docker|host]

Options:
  --runtime <mode>   Runtime preference. If omitted, setup uses shell env, then .env, then auto-detect.
  -h, --help         Show this help

Behavior:
  - Shared install/build steps run before runtime-specific preparation.
  - If Docker is unavailable and runtime is still unresolved, setup prompts for host or docker.
  - Host choice persists CONTAINER_RUNTIME=host and FFT_NANO_ALLOW_HOST_RUNTIME=1 in .env.
USAGE
}

normalize_runtime_pref() {
  local raw="${1:-auto}"
  raw="$(printf %s "$raw" | tr '[:upper:]' '[:lower:]')"
  if [[ "$raw" != "auto" && "$raw" != "docker" && "$raw" != "host" ]]; then
    fail "Invalid runtime preference: $1 (expected auto|docker|host)"
  fi
  printf '%s' "$raw"
}

SETUP_RUNTIME_PREF=""
SETUP_RUNTIME_SOURCE=""
SETUP_RUNTIME_FLAG=""
SETUP_RUNTIME_SHELL_ENV="${CONTAINER_RUNTIME:-}"
RESOLVED_RUNTIME=""

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "${1}" in
      --runtime)
        [[ $# -ge 2 ]] || fail "--runtime requires a value"
        SETUP_RUNTIME_FLAG="$(normalize_runtime_pref "$2")"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1 (use --help for usage)"
        ;;
    esac
  done
}

read_env_value() {
  local key="$1"
  [[ -f .env ]] || return
  local value
  value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

load_env_file() {
  [[ -f .env ]] || return
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}

resolve_runtime_preference() {
  local file_pref
  file_pref="$(read_env_value CONTAINER_RUNTIME)"

  if [[ -n "$SETUP_RUNTIME_FLAG" ]]; then
    SETUP_RUNTIME_PREF="$SETUP_RUNTIME_FLAG"
    SETUP_RUNTIME_SOURCE="flag --runtime"
    return
  fi
  if [[ -n "$SETUP_RUNTIME_SHELL_ENV" ]]; then
    SETUP_RUNTIME_PREF="$(normalize_runtime_pref "$SETUP_RUNTIME_SHELL_ENV")"
    SETUP_RUNTIME_SOURCE="current shell env CONTAINER_RUNTIME"
    return
  fi
  if [[ -n "$file_pref" ]]; then
    SETUP_RUNTIME_PREF="$(normalize_runtime_pref "$file_pref")"
    SETUP_RUNTIME_SOURCE=".env CONTAINER_RUNTIME"
    return
  fi

  SETUP_RUNTIME_PREF="auto"
  SETUP_RUNTIME_SOURCE="auto-detect"
}

is_truthy() {
  local raw="${1:-}"
  raw="$(printf %s "$raw" | tr '[:upper:]' '[:lower:]')"
  [[ "$raw" == "1" || "$raw" == "true" || "$raw" == "yes" || "$raw" == "on" ]]
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

docker_daemon_healthy() {
  local err_file="$1"
  : >"$err_file"
  if perl -e 'my $t=shift; alarm $t; my $rc=system(@ARGV); exit($rc >> 8);' \
    8 docker info >/dev/null 2>"$err_file"; then
    return 0
  fi
  return 1
}

node_major() {
  node -p 'process.versions.node.split(".")[0]'
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp
  local updated=0
  tmp="$(mktemp -t fft_nano_env.XXXXXX)"
  if [[ -f .env ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" == "${key}="* ]]; then
        printf '%s=%s\n' "$key" "$value" >>"$tmp"
        updated=1
      else
        printf '%s\n' "$line" >>"$tmp"
      fi
    done < .env
  fi
  if [[ "$updated" -eq 0 ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  mv "$tmp" .env
}

unset_env_value() {
  local key="$1"
  local tmp
  tmp="$(mktemp -t fft_nano_env.XXXXXX)"
  if [[ -f .env ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" == "${key}="* ]]; then
        continue
      fi
      printf '%s\n' "$line" >>"$tmp"
    done < .env
  fi
  mv "$tmp" .env
}

persist_host_runtime() {
  set_env_value CONTAINER_RUNTIME host
  set_env_value FFT_NANO_ALLOW_HOST_RUNTIME 1
  export CONTAINER_RUNTIME=host
  export FFT_NANO_ALLOW_HOST_RUNTIME=1
}

persist_docker_first_runtime() {
  local pref="${1:-auto}"
  set_env_value CONTAINER_RUNTIME "$pref"
  unset_env_value FFT_NANO_ALLOW_HOST_RUNTIME
  export CONTAINER_RUNTIME="$pref"
  unset FFT_NANO_ALLOW_HOST_RUNTIME || true
}

docker_available_and_healthy() {
  command -v docker >/dev/null 2>&1 || return 1
  local docker_err
  docker_err="$(mktemp -t fft_nano_docker_info.XXXXXX)"
  if docker_daemon_healthy "$docker_err"; then
    rm -f "$docker_err"
    return 0
  fi
  rm -f "$docker_err"
  return 1
}

prompt_runtime_choice() {
  local answer
  local say_err
  say_err() { printf '%s\n' "$*" >&2; }
  while true; do
    say_err ""
    say_err "Docker is not currently available for the agent runtime."
    say_err "Choose runtime:"
    say_err "  host   (default, continues without Docker isolation)"
    say_err "  docker (write Docker-first defaults, then stop so you can install/start Docker)"
    read -r -p "Runtime [host/docker] [host]: " answer
    answer="$(printf %s "${answer:-}" | tr '[:upper:]' '[:lower:]')"
    case "$answer" in
      ""|h|host)
        printf 'host'
        return
        ;;
      d|docker)
        printf 'docker'
        return
        ;;
    esac
    say_err "Please enter host or docker."
  done
}

resolve_runtime() {
  case "$SETUP_RUNTIME_PREF" in
    host)
      persist_host_runtime
      RESOLVED_RUNTIME="host"
      return
      ;;
    docker)
      persist_docker_first_runtime docker
      RESOLVED_RUNTIME="docker"
      return
      ;;
  esac

  if docker_available_and_healthy; then
    persist_docker_first_runtime auto
    RESOLVED_RUNTIME="docker"
    return
  fi

  if [[ ! -t 0 ]]; then
    fail "Docker is unavailable. Install Docker, or re-run with --runtime host to continue without Docker."
  fi

  local choice
  choice="$(prompt_runtime_choice)"
  if [[ "$choice" == "host" ]]; then
    persist_host_runtime
    RESOLVED_RUNTIME="host"
    return
  fi

  persist_docker_first_runtime auto
  say ""
  say "Docker-first runtime selected."
  say "Install/start Docker, then re-run ./scripts/setup.sh to prepare the agent runtime."
  exit 0
}

ensure_runtime_ready() {
  local runtime="$1"
  if [[ "$runtime" == "docker" ]]; then
    need_cmd docker
    local docker_err
    docker_err="$(mktemp -t fft_nano_docker_info.XXXXXX)"
    if ! docker_daemon_healthy "$docker_err"; then
      local err_preview
      err_preview="$(tr '\n' ' ' <"$docker_err" | sed 's/[[:space:]]\+/ /g' | cut -c1-220)"
      local no_space=0
      if grep -qi "no space left on device" "$docker_err" 2>/dev/null || \
        grep -qi "no space left on device" "$HOME/Library/Containers/com.docker.docker/Data/log/host/com.docker.backend.log" 2>/dev/null; then
        no_space=1
      fi
      rm -f "$docker_err"
      if [[ "$no_space" -eq 1 ]]; then
        fail "Docker daemon unhealthy (disk/full VM signature detected: no space left on device). Run ./scripts/docker-recover.sh, then retry ./scripts/setup.sh."
      fi
      fail "Docker is installed but not healthy (docker info failed/timed out). Start Docker Desktop (macOS) or docker daemon (Linux). Details: ${err_preview:-none}. If this persists, run ./scripts/docker-recover.sh."
    fi
    rm -f "$docker_err"
    return
  fi

  if ! is_truthy "${FFT_NANO_ALLOW_HOST_RUNTIME:-0}"; then
    fail "Host runtime requires explicit opt-in: FFT_NANO_ALLOW_HOST_RUNTIME=1"
  fi
  if [[ "${NODE_ENV:-}" == "production" ]] && ! is_truthy "${FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD:-0}"; then
    fail "Host runtime is blocked in production unless FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD=1"
  fi

  local host_pi="$ROOT_DIR/node_modules/.bin/pi"
  if command -v pi >/dev/null 2>&1; then
    return
  fi

  if [[ ! -x "$host_pi" ]]; then
    fail "Host runtime requires pi on PATH or ${host_pi}. Re-run npm install, set PI_PATH, or install @mariozechner/pi-coding-agent globally."
  fi
}

scaffold_env() {
  if [[ -f .env ]]; then
    return
  fi
  if [[ ! -f .env.example ]]; then
    fail "Missing .env.example (expected in repo root)"
  fi
  cp .env.example .env
  say "Created .env from .env.example (fill in keys/endpoints before running)."
}

ensure_admin_secret() {
  local env_file=".env"
  [[ -f "$env_file" ]] || return
  if grep -Eq '^TELEGRAM_ADMIN_SECRET=' "$env_file"; then
    return
  fi
  local generated
  generated="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
  {
    printf '\n'
    printf 'TELEGRAM_ADMIN_SECRET=%s\n' "$generated"
  } >>"$env_file"
  say "Generated TELEGRAM_ADMIN_SECRET in .env (used by Telegram /main claim flow)."
}

scaffold_mount_allowlist() {
  local dst="${HOME}/.config/fft_nano/mount-allowlist.json"
  if [[ -f "$dst" ]]; then
    return
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ -f config-examples/mount-allowlist.json ]]; then
    cp config-examples/mount-allowlist.json "$dst"
    say "Created mount allowlist: $dst"
  fi
}

say "FFT_nano setup (root: $ROOT_DIR)"
parse_args "$@"

need_cmd node
need_cmd npm

maj="$(node_major)"
if [[ "$maj" -lt 20 ]]; then
  fail "Node.js 20+ required (found $(node -v))."
fi

scaffold_env
load_env_file
resolve_runtime_preference

say "Installing dependencies..."
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

say "Typecheck..."
npm run typecheck

say "Build..."
npm run build

if [[ -f web/control-center/package.json ]]; then
  say "Building FFT Control Center..."
  if [[ -f web/control-center/package-lock.json ]]; then
    npm --prefix web/control-center ci
  else
    npm --prefix web/control-center install
  fi
  npm --prefix web/control-center run build
fi

resolve_runtime
runtime="$RESOLVED_RUNTIME"
say "Detected container runtime: $runtime (preference=${SETUP_RUNTIME_PREF}, source=${SETUP_RUNTIME_SOURCE})"
ensure_runtime_ready "$runtime"

say "Preparing agent runtime..."
if [[ "$runtime" == "docker" ]]; then
  ./container/build-docker.sh
  say "Smoke test: pi availability"
  echo '{"prompt":"ping","groupFolder":"setup","chatJid":"setup","isMain":false}' | docker run -i --rm --entrypoint pi "${CONTAINER_IMAGE:-fft-nano-agent:latest}" --version >/dev/null 2>&1 || true
else
  say "Host runtime selected: skipping container image build."
  say "Smoke test: host pi availability"
  if command -v pi >/dev/null 2>&1; then
    pi --version >/dev/null 2>&1 || true
  else
    PATH="$ROOT_DIR/node_modules/.bin:${PATH}" pi --version >/dev/null 2>&1 || true
  fi
fi

if is_truthy "${FFT_NANO_AUTO_LINK:-1}"; then
  say "Linking FFT CLI globally (npm link)..."
  if npm link; then
    say "CLI linked: use 'fft ...' from this checkout."
  else
    say "WARN: npm link failed. Continue with ./scripts/... commands or run npm link manually."
  fi
else
  say "Skipping CLI global link (FFT_NANO_AUTO_LINK disabled)."
fi

ensure_admin_secret
scaffold_mount_allowlist

if is_truthy "${FFT_NANO_AUTO_SERVICE:-1}"; then
  say "Installing and starting host service..."
  ./scripts/service.sh install
  say "Host service is active and will auto-start after reboot."
else
  say "Skipping host service install (FFT_NANO_AUTO_SERVICE disabled)."
fi

say ""
say "Next:"
say "  edit .env                # set provider key + TELEGRAM_BOT_TOKEN (+ TELEGRAM_ADMIN_SECRET)"
say "  ./scripts/service.sh restart  # apply .env changes"
say "  ./scripts/service.sh status   # check daemon/service health"
say "  ./scripts/service.sh logs     # view recent service logs"
say "  ./scripts/web.sh              # show FFT CONTROL CENTER URL"
say "  ./scripts/start.sh tui        # attach TUI to running host"
say "  ./scripts/onboard.sh --operator \"Your Name\" --assistant-name OpenClaw --non-interactive"
say "  Telegram DM: /id then /main <secret>"
say ""
say "If using WhatsApp, authenticate once:"
say "  npm run auth"
