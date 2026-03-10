#!/usr/bin/env bash
set -euo pipefail

# Recover Docker Desktop when daemon is unresponsive (EOF / cannot connect)
# and optionally rebuild Docker VM disk image when no-space errors occur.

say() { printf "%s\n" "$*"; }
fail() { printf "\nERROR: %s\n" "$*" >&2; exit 1; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "docker-recover.sh currently targets macOS Docker Desktop only."
fi

if ! command -v docker >/dev/null 2>&1; then
  fail "docker CLI not found. Install Docker Desktop first."
fi

if ! command -v open >/dev/null 2>&1; then
  fail "macOS 'open' command not found."
fi

docker_daemon_healthy() {
  local err_file="$1"
  : >"$err_file"
  if perl -e 'my $t=shift; alarm $t; my $rc=system(@ARGV); exit($rc >> 8);' \
    4 docker version --format '{{.Server.Version}}' >/tmp/fft_nano_docker_server_version.out 2>"$err_file"; then
    return 0
  fi
  return 1
}

docker_logs_have_no_space() {
  local backend_log="$HOME/Library/Containers/com.docker.docker/Data/log/host/com.docker.backend.log"
  local virt_log="$HOME/Library/Containers/com.docker.docker/Data/log/host/com.docker.virtualization.log"
  grep -qi "no space left on device" "$backend_log" 2>/dev/null || \
    grep -qi "no space left on device" "$virt_log" 2>/dev/null
}

force_stop_desktop() {
  pkill -9 -f "Docker Desktop" || true
  pkill -9 -f "com.docker.backend" || true
  pkill -9 -f "com.docker.virtualization" || true
  pkill -9 -f "vpnkit" || true
  pkill -9 -f "docker desktop" || true
}

wait_for_daemon() {
  local seconds="$1"
  local err_file="$2"
  local i
  for i in $(seq 1 "$seconds"); do
    if docker_daemon_healthy "$err_file"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_PATH="$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
BACKUP_DIR="${FFT_NANO_DOCKER_BACKUP_DIR:-$HOME/fft_nano_docker_backups}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
ERR_FILE="$(mktemp -t fft_nano_docker_recover.XXXXXX)"

say "Docker recovery start"
say "Repo: $ROOT_DIR"

if docker_daemon_healthy "$ERR_FILE"; then
  say "Docker daemon already healthy (server $(cat /tmp/fft_nano_docker_server_version.out 2>/dev/null || echo unknown))."
  rm -f "$ERR_FILE"
  exit 0
fi

say "Initial daemon check failed: $(tr '\n' ' ' <"$ERR_FILE" | sed 's/[[:space:]]\+/ /g' | cut -c1-220)"

say "Step 1: hard restart Docker Desktop processes"
force_stop_desktop
sleep 2
open -a Docker
if wait_for_daemon 120 "$ERR_FILE"; then
  say "Docker daemon recovered after hard restart."
  rm -f "$ERR_FILE"
  exit 0
fi

if ! docker_logs_have_no_space; then
  fail "Docker still unhealthy after hard restart and no 'no space left on device' marker found. Last error: $(tr '\n' ' ' <"$ERR_FILE" | sed 's/[[:space:]]\+/ /g' | cut -c1-220)"
fi

say "Step 2: no-space marker detected; rebuilding Docker VM disk image"
if [[ ! -f "$RAW_PATH" ]]; then
  fail "Expected Docker.raw not found at $RAW_PATH"
fi

mkdir -p "$BACKUP_DIR"
BACKUP_RAW="$BACKUP_DIR/Docker.raw.$TS"

force_stop_desktop
sleep 2
mv "$RAW_PATH" "$BACKUP_RAW"

say "Backed up old Docker VM disk: $BACKUP_RAW"
say "Starting Docker Desktop with fresh disk image..."
open -a Docker

if wait_for_daemon 180 "$ERR_FILE"; then
  say "Docker daemon healthy (server $(cat /tmp/fft_nano_docker_server_version.out 2>/dev/null || echo unknown))."
  say "Note: Docker images/containers from old VM disk are not active. Backup remains at: $BACKUP_RAW"
  rm -f "$ERR_FILE"
  exit 0
fi

fail "Docker still unhealthy after disk image reset. Last error: $(tr '\n' ' ' <"$ERR_FILE" | sed 's/[[:space:]]\+/ /g' | cut -c1-220)"
