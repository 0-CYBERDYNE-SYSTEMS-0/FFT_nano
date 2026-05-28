#!/usr/bin/env bash
set -euo pipefail

REPO="${FFT_NANO_REPO:-0-CYBERDYNE-SYSTEMS-0/FFT_nano}"
REF="${FFT_NANO_REF:-latest}"
INSTALL_DIR="${FFT_NANO_INSTALL_DIR:-$HOME/FFT_nano}"
FORCE="${FFT_NANO_FORCE:-0}"
AUTO_LINK="${FFT_NANO_AUTO_LINK:-1}"

say() { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

is_truthy() {
  local raw="${1:-}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  [[ "$raw" == "1" || "$raw" == "true" || "$raw" == "yes" || "$raw" == "on" ]]
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

is_termux() {
  [[ -n "${TERMUX_VERSION:-}" ]] || [[ "${PREFIX:-}" == *com.termux* ]] || [[ -d /data/data/com.termux/files/usr ]]
}

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return
  fi
  if has_cmd sudo; then
    sudo "$@"
    return
  fi
  fail "Need administrator privileges to run: $*"
}

node_major() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0'
}

detect_os() {
  case "$(uname -s)" in
    Darwin) printf 'macos' ;;
    Linux) printf 'linux' ;;
    *) printf 'unknown' ;;
  esac
}

install_linux_basics() {
  if has_cmd apt-get; then
    say "Installing required system packages..."
    run_privileged apt-get update
    run_privileged apt-get install -y curl ca-certificates tar bash
    return
  fi
  warn "Could not auto-install base packages on this Linux distribution."
}

install_termux_basics() {
  if ! has_cmd pkg; then
    warn "Termux detected, but pkg is not available. Install curl, tar, bash, and Node.js 20+ manually if setup fails."
    return
  fi

  local packages=()
  has_cmd curl || packages+=(curl)
  has_cmd tar || packages+=(tar)
  has_cmd bash || packages+=(bash)
  has_cmd node || packages+=(nodejs-lts)

  if [[ "${#packages[@]}" -gt 0 ]]; then
    say "Installing Termux packages: ${packages[*]}"
    pkg install -y "${packages[@]}"
  fi
}

install_node_linux() {
  if ! has_cmd apt-get; then
    return 1
  fi
  say "Installing Node.js 20..."
  local tmp
  tmp="$(mktemp -t fft-nano-node-setup.XXXXXX)"
  curl -fsSL https://deb.nodesource.com/setup_20.x -o "$tmp"
  run_privileged bash "$tmp"
  rm -f "$tmp"
  run_privileged apt-get install -y nodejs
}

install_node_termux() {
  if ! has_cmd pkg; then
    return 1
  fi
  say "Installing Node.js with Termux pkg..."
  pkg install -y nodejs-lts
}

install_node_macos() {
  if ! has_cmd brew; then
    return 1
  fi
  say "Installing Node.js with Homebrew..."
  brew install node
}

ensure_node() {
  if has_cmd node && [[ "$(node_major)" -ge 20 ]] && has_cmd npm; then
    return
  fi

  say "Node.js 20+ is required. I will try to install it now."
  if is_termux; then
    install_node_termux || fail "Install Node.js 20+ in Termux, then rerun this installer: pkg install nodejs-lts"
  else
    case "$(detect_os)" in
      linux)
        install_node_linux || fail "Install Node.js 20+, then rerun this installer."
        ;;
      macos)
        install_node_macos || fail "Install Homebrew or Node.js 20+, then rerun this installer."
        ;;
      *)
        fail "Unsupported OS. Install Node.js 20+ and npm, then rerun this installer."
        ;;
    esac
  fi

  has_cmd node || fail "Node.js install did not make node available."
  has_cmd npm || fail "Node.js install did not make npm available."
  [[ "$(node_major)" -ge 20 ]] || fail "Node.js 20+ required; found $(node -v)."
}

docker_healthy() {
  has_cmd docker || return 1
  docker info >/dev/null 2>&1
}

args_have_runtime() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --runtime|--runtime=*) return 0 ;;
    esac
  done
  return 1
}

build_termux_user_args() {
  local skip_next=0
  local arg
  TERMUX_USER_ARGS=()
  for arg in "$@"; do
    if [[ "$skip_next" -eq 1 ]]; then
      skip_next=0
      continue
    fi
    case "$arg" in
      --runtime)
        skip_next=1
        ;;
      --runtime=*|--install-daemon|--no-install-daemon)
        ;;
      *)
        TERMUX_USER_ARGS+=("$arg")
        ;;
    esac
  done
}

resolve_ref() {
  if [[ "$REF" != "latest" ]]; then
    printf '%s' "$REF"
    return
  fi

  local latest_url location tag
  latest_url="https://github.com/${REPO}/releases/latest"
  location="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$latest_url")"
  tag="${location##*/}"
  [[ -n "$tag" && "$tag" != "latest" ]] || fail "Could not resolve latest release for ${REPO}."
  printf '%s' "$tag"
}

download_archive() {
  local ref="$1"
  local out="$2"
  local url

  if [[ "$ref" == "main" || "$ref" == "master" || "$ref" == refs/heads/* ]]; then
    local branch="${ref#refs/heads/}"
    url="https://github.com/${REPO}/archive/refs/heads/${branch}.tar.gz"
  elif [[ "$ref" == refs/tags/* ]]; then
    local tag="${ref#refs/tags/}"
    url="https://github.com/${REPO}/archive/refs/tags/${tag}.tar.gz"
  elif [[ "$ref" == v* ]]; then
    url="https://github.com/${REPO}/archive/refs/tags/${ref}.tar.gz"
  else
    url="https://github.com/${REPO}/archive/${ref}.tar.gz"
  fi

  say "Downloading FFT_nano ${ref}..."
  curl -fsSL "$url" -o "$out"
}

is_empty_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  [[ -z "$(find "$dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp -t fft-nano-env.XXXXXX)"

  if [[ -f "$file" ]]; then
    awk -v key="$key" -v value="$value" '
      BEGIN { done = 0 }
      $0 ~ "^" key "=" {
        print key "=" value
        done = 1
        next
      }
      { print }
      END {
        if (!done) print key "=" value
      }
    ' "$file" >"$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >"$tmp"
  fi

  mv "$tmp" "$file"
}

seed_env_from_shell() {
  local env_file="$1"
  local key value
  local keys=(
    ASSISTANT_NAME
    FFT_NANO_RUNTIME_PROVIDER_PRESET
    PI_API
    PI_MODEL
    PI_API_KEY
    OPENAI_API_KEY
    OPENAI_BASE_URL
    ANTHROPIC_API_KEY
    GEMINI_API_KEY
    OPENROUTER_API_KEY
    OPENCODE_API_KEY
    ZAI_API_KEY
    MINIMAX_API_KEY
    KIMI_API_KEY
    TELEGRAM_BOT_TOKEN
    TELEGRAM_ADMIN_SECRET
    TELEGRAM_MAIN_CHAT_ID
    WHATSAPP_ENABLED
    CONTAINER_RUNTIME
    FFT_NANO_ALLOW_HOST_RUNTIME
    FFT_NANO_MAIN_WORKSPACE_DIR
  )

  for key in "${keys[@]}"; do
    value="${!key-}"
    if [[ -n "$value" ]]; then
      set_env_value "$env_file" "$key" "$value"
    fi
  done
}

main() {
  say "FFT_nano installer"
  say "Install directory: ${INSTALL_DIR}"

  if is_termux; then
    say "Android Termux detected. Using foreground host runtime; daemon/service install is disabled."
    install_termux_basics
  else
    need_cmd curl
    case "$(detect_os)" in
      linux) install_linux_basics ;;
      macos) need_cmd tar ;;
      *) fail "Unsupported OS: $(uname -s)" ;;
    esac
  fi
  need_cmd curl
  need_cmd tar
  ensure_node

  local runtime_args=()
  if is_termux; then
    runtime_args=(--runtime host --no-install-daemon)
    export CONTAINER_RUNTIME=host
    export FFT_NANO_ALLOW_HOST_RUNTIME=1
    AUTO_LINK=0
    export FFT_NANO_AUTO_LINK=0
  elif ! args_have_runtime "$@"; then
    if docker_healthy; then
      runtime_args=(--runtime docker)
      say "Docker is available. Using isolated Docker runtime."
    else
      runtime_args=(--runtime host)
      export CONTAINER_RUNTIME=host
      export FFT_NANO_ALLOW_HOST_RUNTIME=1
      say "Docker is not available or not healthy. Using host runtime so setup can continue."
    fi
  fi

  if [[ -e "$INSTALL_DIR" ]] && ! is_empty_dir "$INSTALL_DIR"; then
    if is_truthy "$FORCE"; then
      warn "FFT_NANO_FORCE=1 set; replacing ${INSTALL_DIR}."
      rm -rf "$INSTALL_DIR"
    else
      fail "${INSTALL_DIR} already exists and is not empty. Set FFT_NANO_INSTALL_DIR to a new path or FFT_NANO_FORCE=1 to replace it."
    fi
  fi

  local resolved_ref archive tmpdir extracted
  resolved_ref="$(resolve_ref)"
  tmpdir="$(mktemp -d -t fft-nano-install.XXXXXX)"
  archive="$tmpdir/fft_nano.tar.gz"
  download_archive "$resolved_ref" "$archive"

  mkdir -p "$(dirname "$INSTALL_DIR")"
  tar -xzf "$archive" -C "$tmpdir"
  extracted="$(find "$tmpdir" -mindepth 1 -maxdepth 1 -type d -name 'FFT_nano-*' -print -quit)"
  [[ -n "$extracted" ]] || fail "Downloaded archive did not contain an FFT_nano source directory."
  if [[ -d "$INSTALL_DIR" ]]; then
    rmdir "$INSTALL_DIR"
  fi
  mv "$extracted" "$INSTALL_DIR"
  rm -rf "$tmpdir"

  cd "$INSTALL_DIR"
  if [[ ! -f .env && -f .env.example ]]; then
    cp .env.example .env
  fi
  seed_env_from_shell "$INSTALL_DIR/.env"
  if is_termux; then
    set_env_value "$INSTALL_DIR/.env" CONTAINER_RUNTIME host
    set_env_value "$INSTALL_DIR/.env" FFT_NANO_ALLOW_HOST_RUNTIME 1
  fi

  export FFT_NANO_AUTO_LINK="$AUTO_LINK"
  say "Starting guided setup..."
  if is_termux; then
    build_termux_user_args "$@"
    ./scripts/onboard-all.sh "${runtime_args[@]}" "${TERMUX_USER_ARGS[@]}"
    say ""
    say "Termux install complete. Run FFT_nano in the foreground from ${INSTALL_DIR}:"
    say "  ./scripts/start.sh start"
    say "Keep the Termux session running; Android daemon persistence is not installed."
  else
    ./scripts/onboard-all.sh "${runtime_args[@]}" "$@"
  fi
}

main "$@"
