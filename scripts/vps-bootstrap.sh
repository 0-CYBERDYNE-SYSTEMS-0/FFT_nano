#!/usr/bin/env bash
set -euo pipefail

# VPS Bootstrap Script for FFT_nano
# Fully automated deployment to cloud VPS instances
#
# Usage:
#   ./scripts/vps-bootstrap.sh \
#     --host vps1.example.com \
#     --ssh-key ~/.ssh/deploy_key \
#     --telegram-token "YOUR_BOT_TOKEN" \
#     --telegram-chat-id "YOUR_CHAT_ID" \
#     --openrouter-key "YOUR_OPENROUTER_KEY" \
#     --operator "Your Name"
#
# Environment variables (alternative to flags):
#   VPS_HOST, VPS_SSH_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
#   OPENROUTER_API_KEY, OPERATOR_NAME, ASSISTANT_NAME

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Configuration with defaults
VPS_HOST="${VPS_HOST:-}"
VPS_SSH_KEY="${VPS_SSH_KEY:-${HOME}/.ssh/id_rsa}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"

# Required secrets
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"

# Optional configuration
OPERATOR_NAME="${OPERATOR_NAME:-Admin}"
ASSISTANT_NAME="${ASSISTANT_NAME:-FFT-Agent}"
FFT_REPO="${FFT_REPO:-https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git}"
FFT_BRANCH="${FFT_BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/fft_nano}"

# Feature flags
SKIP_DOCKER_INSTALL="${SKIP_DOCKER_INSTALL:-0}"
SKIP_NODE_INSTALL="${SKIP_NODE_INSTALL:-0}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-bootstrap.sh [options]

Required:
  --host <hostname>              VPS hostname or IP
  --telegram-token <token>       Telegram bot token
  --telegram-chat-id <id>        Your Telegram chat ID (for main/admin)
  --openrouter-key <key>         OpenRouter API key

Optional:
  --ssh-key <path>               SSH private key (default: ~/.ssh/id_rsa)
  --ssh-user <user>              SSH user (default: root)
  --ssh-port <port>              SSH port (default: 22)
  --operator <name>              Operator name (default: Admin)
  --assistant-name <name>        Assistant name (default: FFT-Agent)
  --repo <url>                   Git repo URL
  --branch <branch>              Git branch (default: main)
  --install-dir <path>           Install directory (default: /opt/fft_nano)
  --skip-docker-install          Skip Docker installation
  --skip-node-install            Skip Node.js installation
  --dry-run                      Show what would be done, don't execute
  -h, --help                     Show this help

Environment variables:
  VPS_HOST, VPS_SSH_KEY, VPS_USER, VPS_PORT
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, OPENROUTER_API_KEY
  OPERATOR_NAME, ASSISTANT_NAME

Examples:
  # Basic deployment
  ./scripts/vps-bootstrap.sh \
    --host vps1.example.com \
    --telegram-token "123456:ABC..." \
    --telegram-chat-id "123456789" \
    --openrouter-key "sk-or-..."

  # With specific SSH key and custom assistant name
  ./scripts/vps-bootstrap.sh \
    --host vps2.example.com \
    --ssh-key ~/.ssh/vps_deploy \
    --telegram-token "123456:ABC..." \
    --telegram-chat-id "123456789" \
    --openrouter-key "sk-or-..." \
    --assistant-name "VPS-Agent-2"
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host)
        VPS_HOST="$2"
        shift 2
        ;;
      --ssh-key)
        VPS_SSH_KEY="$2"
        shift 2
        ;;
      --ssh-user)
        VPS_USER="$2"
        shift 2
        ;;
      --ssh-port)
        VPS_PORT="$2"
        shift 2
        ;;
      --telegram-token)
        TELEGRAM_BOT_TOKEN="$2"
        shift 2
        ;;
      --telegram-chat-id)
        TELEGRAM_CHAT_ID="$2"
        shift 2
        ;;
      --openrouter-key)
        OPENROUTER_API_KEY="$2"
        shift 2
        ;;
      --operator)
        OPERATOR_NAME="$2"
        shift 2
        ;;
      --assistant-name)
        ASSISTANT_NAME="$2"
        shift 2
        ;;
      --repo)
        FFT_REPO="$2"
        shift 2
        ;;
      --branch)
        FFT_BRANCH="$2"
        shift 2
        ;;
      --install-dir)
        INSTALL_DIR="$2"
        shift 2
        ;;
      --skip-docker-install)
        SKIP_DOCKER_INSTALL=1
        shift
        ;;
      --skip-node-install)
        SKIP_NODE_INSTALL=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
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
}

validate_inputs() {
  [[ -n "$VPS_HOST" ]] || fail "--host is required"
  [[ -n "$TELEGRAM_BOT_TOKEN" ]] || fail "--telegram-token is required"
  [[ -n "$TELEGRAM_CHAT_ID" ]] || fail "--telegram-chat-id is required"
  [[ -n "$OPENROUTER_API_KEY" ]] || fail "--openrouter-key is required"
  [[ -f "$VPS_SSH_KEY" ]] || fail "SSH key not found: $VPS_SSH_KEY"
}

ssh_cmd() {
  ssh -i "$VPS_SSH_KEY" -p "$VPS_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 "$VPS_USER@$VPS_HOST" "$@"
}

ssh_script() {
  ssh -i "$VPS_SSH_KEY" -p "$VPS_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 "$VPS_USER@$VPS_HOST" 'bash -s'
}

generate_env_file() {
  local admin_secret
  admin_secret="$(openssl rand -hex 24)"

  cat <<EOF
# FFT_nano Environment Configuration
# Auto-generated by vps-bootstrap.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Host: $VPS_HOST
# Assistant: $ASSISTANT_NAME

# Channels
WHATSAPP_ENABLED=0
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_SECRET=$admin_secret
TELEGRAM_MAIN_CHAT_ID=$TELEGRAM_CHAT_ID
ASSISTANT_NAME=$ASSISTANT_NAME

# LLM Provider (OpenRouter)
FFT_NANO_RUNTIME_PROVIDER_PRESET=openrouter
PI_API=openrouter
PI_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_API_KEY=$OPENROUTER_API_KEY

# Runtime
CONTAINER_RUNTIME=auto
FFT_NANO_AUTO_SERVICE=1
FFT_NANO_AUTO_LINK=1

# Workspace
FFT_NANO_MAIN_WORKSPACE_DIR=$INSTALL_DIR/workspace

# TUI/Web
FFT_NANO_TUI_ENABLED=1
FFT_NANO_WEB_ENABLED=1
FFT_NANO_WEB_ACCESS_MODE=localhost

# Logging
LOG_LEVEL=info
EOF
}

generate_bootstrap_script() {
  cat <<'BOOTSTRAP_EOF'
#!/bin/bash
set -euo pipefail

INSTALL_DIR="$1"
FFT_REPO="$2"
FFT_BRANCH="$3"
SKIP_DOCKER="$4"
SKIP_NODE="$5"

say() { echo "[bootstrap] $*"; }

# Detect OS
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS="$ID"
else
  OS="unknown"
fi

# Install base packages
say "Installing base packages..."
if [[ "$OS" == "ubuntu" || "$OS" == "debian" || "$OS" == "raspbian" ]]; then
  apt-get update
  apt-get install -y git curl ca-certificates openssl
elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "fedora" || "$OS" == "almalinux" || "$OS" == "rocky" ]]; then
  yum install -y git curl ca-certificates openssl
elif [[ "$OS" == "arch" || "$OS" == "manjaro" ]]; then
  pacman -Sy --noconfirm git curl ca-certificates openssl
else
  say "Unknown OS, attempting generic install..."
  apt-get update && apt-get install -y git curl ca-certificates openssl 2>/dev/null || \
  yum install -y git curl ca-certificates openssl 2>/dev/null || true
fi

# Install Node.js 20+ if needed
if [[ "$SKIP_NODE" != "1" ]]; then
  if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 20 ]]; then
    say "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
fi

# Verify Node
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found"
  exit 1
fi
NODE_VER="$(node -v)"
say "Node.js version: $NODE_VER"

# Install Docker if needed
if [[ "$SKIP_DOCKER" != "1" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    say "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker "$(whoami)" 2>/dev/null || true
  fi
fi

# Start Docker
if command -v docker >/dev/null 2>&1; then
  systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true
  sleep 2
  docker info >/dev/null 2>&1 || say "WARNING: Docker not healthy"
fi

# Create install directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Clone repo
if [[ -d ".git" ]]; then
  say "Updating existing repo..."
  git fetch origin
  git checkout "$FFT_BRANCH"
  git pull origin "$FFT_BRANCH"
else
  say "Cloning FFT_nano..."
  git clone --branch "$FFT_BRANCH" "$FFT_REPO" .
fi

# The .env file should already be in place
if [[ ! -f ".env" ]]; then
  echo "ERROR: .env file not found"
  exit 1
fi

# Run setup
say "Running setup..."
export FFT_NANO_AUTO_SERVICE=0  # We'll handle service separately
./scripts/setup.sh

# Run onboarding
say "Running onboarding..."
./scripts/onboard-all.sh \
  --non-interactive \
  --accept-risk \
  --operator "$OPERATOR_NAME" \
  --assistant-name "$ASSISTANT_NAME" \
  --telegram-main-chat-id "$TELEGRAM_CHAT_ID" \
  --install-daemon

# Start service
say "Starting service..."
./scripts/service.sh restart || ./scripts/service.sh start

# Health check
say "Health check..."
sleep 3
if ./scripts/service.sh status >/dev/null 2>&1; then
  say "Service is running!"
else
  say "WARNING: Service status check failed"
fi

say "Bootstrap complete!"
BOOTSTRAP_EOF
}

deploy() {
  say "========================================"
  say "FFT_nano VPS Bootstrap"
  say "========================================"
  say "Target: $VPS_USER@$VPS_HOST:$VPS_PORT"
  say "Assistant: $ASSISTANT_NAME"
  say "Install dir: $INSTALL_DIR"
  say ""

  if [[ "$DRY_RUN" == "1" ]]; then
    say "DRY RUN MODE - Commands that would be executed:"
    say ""
    say "1. SSH to $VPS_USER@$VPS_HOST"
    say "2. Install base packages (git, curl, node, docker)"
    say "3. Clone $FFT_REPO ($FFT_BRANCH) to $INSTALL_DIR"
    say "4. Write .env file with pre-configured secrets"
    say "5. Run ./scripts/setup.sh"
    say "6. Run ./scripts/onboard-all.sh --non-interactive ..."
    say "7. Start service via ./scripts/service.sh"
    say ""
    say "Generated .env would contain:"
    generate_env_file | head -20
    return 0
  fi

  # Test SSH connection
  say "Testing SSH connection..."
  if ! ssh_cmd "echo 'SSH OK'" >/dev/null 2>&1; then
    fail "Cannot connect to $VPS_HOST via SSH"
  fi
  say "SSH connection successful"

  # Generate and upload .env
  say "Generating environment file..."
  ENV_CONTENT="$(generate_env_file)"

  say "Uploading .env to VPS..."
  ssh_cmd "mkdir -p $INSTALL_DIR"
  echo "$ENV_CONTENT" | ssh_cmd "cat > $INSTALL_DIR/.env"
  ssh_cmd "chmod 600 $INSTALL_DIR/.env"

  # Generate and run bootstrap script
  say "Running remote bootstrap..."
  generate_bootstrap_script | ssh_script "$INSTALL_DIR" "$FFT_REPO" "$FFT_BRANCH" "$SKIP_DOCKER_INSTALL" "$SKIP_NODE_INSTALL"

  say ""
  say "========================================"
  say "Deployment Complete!"
  say "========================================"
  say "Host: $VPS_HOST"
  say "Install: $INSTALL_DIR"
  say "Assistant: $ASSISTANT_NAME"
  say ""
  say "Check status:"
  say "  ssh -i $VPS_SSH_KEY $VPS_USER@$VPS_HOST '$INSTALL_DIR/scripts/service.sh status'"
  say "View logs:"
  say "  ssh -i $VPS_SSH_KEY $VPS_USER@$VPS_HOST '$INSTALL_DIR/scripts/service.sh logs'"
  say ""
  say "Telegram: Send /status to your bot to verify"
}

# Main
parse_args "$@"
validate_inputs
deploy
