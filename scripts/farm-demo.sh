#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DASH_PATH="${FFT_DASHBOARD_REPO_PATH:-}"
HA_URL_INPUT="${HA_URL:-http://localhost:8123}"
TOKEN_INPUT="${HA_TOKEN:-}"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/farm-demo.sh [--dash-path /abs/path] [--ha-url URL] [--token TOKEN]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dash-path)
      DASH_PATH="${2:-}"; shift 2 ;;
    --ha-url)
      HA_URL_INPUT="${2:-}"; shift 2 ;;
    --token)
      TOKEN_INPUT="${2:-}"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2 ;;
  esac
done

if [[ -z "$DASH_PATH" || ! -d "$DASH_PATH" ]]; then
  echo "Valid --dash-path is required." >&2
  exit 1
fi
if [[ -z "$TOKEN_INPUT" ]]; then
  echo "HA token required for demo validation." >&2
  exit 1
fi

compose_up() {
  if docker compose version >/dev/null 2>&1; then
    docker compose up -d
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose up -d
  else
    echo "Docker Compose not found" >&2
    return 1
  fi
}

echo "[farm-demo] ensuring HA stack is up"
(
  cd "$DASH_PATH"
  compose_up
)

code="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN_INPUT" "$HA_URL_INPUT/api/" || true)"
if [[ "$code" != "200" ]]; then
  echo "[farm-demo] HA token check failed (HTTP $code)" >&2
  exit 1
fi

echo "[farm-demo] starting telemetry simulator briefly"
SIM_LOG="$ROOT_DIR/data/farm-demo-sim.log"
mkdir -p "$ROOT_DIR/data"
(
  cd "$DASH_PATH"
  HA_URL="$HA_URL_INPUT" HA_TOKEN="$TOKEN_INPUT" SIM_TICK_MS=3000 npm run simulate:telemetry > "$SIM_LOG" 2>&1
) &
SIM_PID=$!

sleep 10
sim_killed=0
if kill -0 "$SIM_PID" >/dev/null 2>&1; then
  sim_killed=1
  kill "$SIM_PID" >/dev/null 2>&1 || true
fi

if ! wait "$SIM_PID" >/dev/null 2>&1; then
  if [[ "$sim_killed" -ne 1 ]]; then
    echo "[farm-demo] telemetry simulator exited with failure; see $SIM_LOG" >&2
    exit 1
  fi
fi

page_code="$(curl -sS -o /dev/null -w '%{http_code}' "$HA_URL_INPUT/lovelace/0" || true)"
if [[ "$page_code" != "200" && "$page_code" != "401" ]]; then
  echo "[farm-demo] Lovelace view check unexpected HTTP $page_code" >&2
  exit 1
fi

echo "[farm-demo] Demo path validated"
echo "[farm-demo] log: $SIM_LOG"
