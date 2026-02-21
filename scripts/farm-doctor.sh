#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

HA_URL_INPUT="${HA_URL:-http://localhost:8123}"
MAX_AGE_SECONDS="${FARM_DOCTOR_MAX_AGE_SEC:-60}"
SERVICE_LABEL="${FARM_DOCTOR_LAUNCHD_LABEL:-com.fft_nano}"
CURRENT_JSON="$ROOT_DIR/data/farm-state/current.json"

pass() {
  echo "PASS: $1"
}

fail() {
  echo "FAIL: $1" >&2
  if [[ -n "${2:-}" ]]; then
    echo "HINT: $2" >&2
  fi
  exit 1
}

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker CLI not found" "Install/start Docker Desktop before demos."
fi

if ! node -e "const {execFileSync}=require('node:child_process'); try { execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 8000 }); } catch (_) { process.exit(1); }"; then
  fail "Docker daemon unreachable" "Start Docker Desktop and wait until 'docker info' succeeds."
fi
pass "Docker daemon reachable"

ha_code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "$HA_URL_INPUT/" || true)"
if [[ "$ha_code" != "200" ]]; then
  fail "Home Assistant base URL check failed (HTTP $ha_code at $HA_URL_INPUT)" "Set HA_URL to a reachable endpoint and ensure HA container is running."
fi
pass "Home Assistant HTTP endpoint reachable ($HA_URL_INPUT)"

if [[ -z "${HA_TOKEN:-}" ]]; then
  fail "HA_TOKEN missing" "Set HA_TOKEN in /Users/scrimwiggins/fft_nano/.env."
fi

ha_api_code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $HA_TOKEN" "$HA_URL_INPUT/api/" || true)"
if [[ "$ha_api_code" != "200" ]]; then
  fail "Home Assistant token auth failed (HTTP $ha_api_code)" "Regenerate long-lived token in Home Assistant profile and update HA_TOKEN."
fi
pass "Home Assistant API token valid"

if [[ "$(uname -s)" == "Darwin" ]]; then
  if ! launchctl print "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1; then
    fail "launchd service '$SERVICE_LABEL' is not loaded" "Load/restart with: launchctl kickstart -k gui/$(id -u)/$SERVICE_LABEL"
  fi
else
  if ! pgrep -f '/fft_nano/dist/index.js' >/dev/null 2>&1; then
    fail "fft_nano process not running" "Start with ./scripts/start.sh start telegram-only"
  fi
fi
pass "FFT_nano runtime service is active"

if [[ ! -f "$CURRENT_JSON" ]]; then
  fail "Farm state snapshot missing at $CURRENT_JSON" "Enable FARM_STATE_ENABLED=true and restart fft_nano."
fi

node - "$CURRENT_JSON" "$MAX_AGE_SECONDS" <<'NODE'
const fs = require('fs');

const [filePath, maxAgeRaw] = process.argv.slice(2);
const maxAge = Number(maxAgeRaw) || 60;

function fail(msg, hint) {
  console.error(`FAIL: ${msg}`);
  if (hint) console.error(`HINT: ${hint}`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (err) {
  fail(`Cannot parse farm state JSON (${String(err)})`, 'Rebuild farm-state by restarting fft_nano.');
}

if (payload.haConnected !== true) {
  fail('Farm state indicates haConnected=false', 'Check HA_URL/HA_TOKEN and watch logs/fft_nano.log for collector errors.');
}

if (!payload.lastSuccessfulPoll) {
  fail('Farm state lastSuccessfulPoll is null', 'Collector has not successfully polled HA yet.');
}

const ts = Date.parse(payload.timestamp || '');
if (!Number.isFinite(ts)) {
  fail('Farm state timestamp is invalid', 'Check collector output in data/farm-state/current.json.');
}

const ageSec = Math.floor((Date.now() - ts) / 1000);
if (ageSec > maxAge) {
  fail(`Farm state is stale (${ageSec}s old; max ${maxAge}s)`, 'Restart fft_nano and verify collector loops are healthy.');
}

console.log(`PASS: Farm state fresh (${ageSec}s old) and connected`);
NODE

echo "PASS: Farm doctor checks completed"
