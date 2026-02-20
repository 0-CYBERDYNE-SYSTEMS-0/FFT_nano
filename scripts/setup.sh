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

is_truthy() {
  local raw="${1:-}"
  raw="$(printf %s "$raw" | tr '[:upper:]' '[:lower:]')"
  [[ "$raw" == "1" || "$raw" == "true" || "$raw" == "yes" || "$raw" == "on" ]]
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

node_major() {
  node -p 'process.versions.node.split(".")[0]'
}

detect_runtime() {
  local raw="${CONTAINER_RUNTIME:-auto}"
  raw="$(printf %s "$raw" | tr '[:upper:]' '[:lower:]')"

  if [[ "$raw" == "apple" ]]; then
    echo "apple"; return
  fi
  if [[ "$raw" == "docker" ]]; then
    echo "docker"; return
  fi
  if [[ "$raw" != "auto" ]]; then
    fail "Invalid CONTAINER_RUNTIME=$CONTAINER_RUNTIME (expected auto|apple|docker)"
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

  fail "No container runtime found. Install Apple Container (macOS) or Docker, or set CONTAINER_RUNTIME explicitly."
}

ensure_runtime_ready() {
  local runtime="$1"
  if [[ "$runtime" == "docker" ]]; then
    need_cmd docker
    if ! docker info >/dev/null 2>&1; then
      fail "Docker is installed but not running (docker info failed). Start Docker Desktop (macOS) or the docker daemon (Linux)."
    fi
    return
  fi

  need_cmd container
  if container system status >/dev/null 2>&1; then
    return
  fi

  say "Apple Container system not running; starting..."
  if ! container system start >/dev/null 2>&1; then
    fail "Apple Container system failed to start. Install from https://github.com/apple/container/releases then run: container system start"
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

need_cmd node
need_cmd npm

maj="$(node_major)"
if [[ "$maj" -lt 20 ]]; then
  fail "Node.js 20+ required (found $(node -v))."
fi

runtime="$(detect_runtime)"
say "Detected container runtime: $runtime"
ensure_runtime_ready "$runtime"

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

say "Building agent image..."
if [[ "$runtime" == "docker" ]]; then
  ./container/build-docker.sh
  say "Smoke test: pi availability"
  echo '{"prompt":"ping","groupFolder":"setup","chatJid":"setup","isMain":false}' | docker run -i --rm --entrypoint pi "${CONTAINER_IMAGE:-fft-nano-agent:latest}" --version >/dev/null 2>&1 || true
else
  ./container/build.sh
  say "Smoke test: pi availability"
  echo '{"prompt":"ping","groupFolder":"setup","chatJid":"setup","isMain":false}' | container run -i --rm --entrypoint pi "${CONTAINER_IMAGE:-fft-nano-agent:latest}" --version >/dev/null 2>&1 || true
fi

scaffold_env
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
say "  ./scripts/start.sh tui        # attach TUI to running host"
say "  ./scripts/onboard.sh --operator \"Your Name\" --assistant-name FarmFriend --non-interactive"
say "  Telegram DM: /id then /main <secret>"
say ""
say "If using WhatsApp, authenticate once:"
say "  npm run auth"
