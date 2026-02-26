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

detect_runtime() {
  local raw="${CONTAINER_RUNTIME:-auto}"
  raw="$(printf %s "$raw" | tr '[:upper:]' '[:lower:]')"

  if [[ "$raw" == "docker" ]]; then
    echo "docker"; return
  fi
  if [[ "$raw" == "host" ]]; then
    echo "host"; return
  fi
  if [[ "$raw" != "auto" ]]; then
    fail "Invalid CONTAINER_RUNTIME=$CONTAINER_RUNTIME (expected auto|docker|host)"
  fi

  if command -v docker >/dev/null 2>&1; then
    echo "docker"; return
  fi
  if is_truthy "${FFT_NANO_ALLOW_HOST_RUNTIME:-0}"; then
    echo "host"; return
  fi

  fail "No supported runtime found. Install Docker, or set CONTAINER_RUNTIME=host with FFT_NANO_ALLOW_HOST_RUNTIME=1."
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

  local host_runner="container/agent-runner/dist/index.js"
  local host_pi="container/agent-runner/node_modules/.bin/pi"
  if [[ ! -f "$host_runner" || ! -x "$host_pi" ]]; then
    say "Preparing host runtime runner dependencies..."
    npm --prefix container/agent-runner install
    npm --prefix container/agent-runner run build
  fi
  if command -v pi >/dev/null 2>&1; then
    return
  fi

  if [[ ! -x "$host_pi" ]]; then
    fail "Host runtime requires pi on PATH or ${host_pi}. Install agent-runner deps: npm --prefix container/agent-runner install"
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

if [[ -f web/control-center/package.json ]]; then
  say "Building FFT Control Center..."
  if [[ -f web/control-center/package-lock.json ]]; then
    npm --prefix web/control-center ci
  else
    npm --prefix web/control-center install
  fi
  npm --prefix web/control-center run build
fi

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
    PATH="$ROOT_DIR/container/agent-runner/node_modules/.bin:${PATH}" pi --version >/dev/null 2>&1 || true
  fi
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
say "  ./scripts/web.sh              # show FFT CONTROL CENTER URL"
say "  ./scripts/start.sh tui        # attach TUI to running host"
say "  ./scripts/onboard.sh --operator \"Your Name\" --assistant-name OpenClaw --non-interactive"
say "  Telegram DM: /id then /main <secret>"
say ""
say "If using WhatsApp, authenticate once:"
say "  npm run auth"
