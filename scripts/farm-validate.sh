#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HA_URL_INPUT="${HA_URL:-http://localhost:8123}"
TOKEN_INPUT="${HA_TOKEN:-}"
PROFILE_PATH_INPUT="${FARM_PROFILE_PATH:-$ROOT_DIR/data/farm-profile.json}"
DASH_PATH_INPUT="${FFT_DASHBOARD_REPO_PATH:-}"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/farm-validate.sh [--ha-url URL] [--token TOKEN] [--profile-path /abs/path]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ha-url)
      HA_URL_INPUT="${2:-}"; shift 2 ;;
    --token)
      TOKEN_INPUT="${2:-}"; shift 2 ;;
    --profile-path)
      PROFILE_PATH_INPUT="${2:-}"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2 ;;
  esac
done

if [[ -z "$TOKEN_INPUT" ]]; then
  echo "HA token required (pass --token or set HA_TOKEN)." >&2
  exit 1
fi
if [[ ! -f "$PROFILE_PATH_INPUT" ]]; then
  echo "Farm profile missing: $PROFILE_PATH_INPUT" >&2
  exit 1
fi

HA_URL="$HA_URL_INPUT" HA_TOKEN="$TOKEN_INPUT" FARM_PROFILE_PATH="$PROFILE_PATH_INPUT" FFT_DASHBOARD_REPO_PATH="$DASH_PATH_INPUT" node <<'NODE'
const fs = require('fs');

const haUrl = process.env.HA_URL.replace(/\/$/, '');
const haToken = process.env.HA_TOKEN;
const profilePath = process.env.FARM_PROFILE_PATH;
const dashboardPath = process.env.FFT_DASHBOARD_REPO_PATH || '';

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${haToken}` },
  });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

(async () => {
  const now = new Date().toISOString();
  const issues = [];

  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
  } catch (err) {
    throw new Error(`Invalid farm profile JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  let states = [];
  try {
    await getJson(`${haUrl}/api/`);
    states = await getJson(`${haUrl}/api/states`);
  } catch (err) {
    issues.push(`HA connectivity/auth failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const ids = new Set(states.map((s) => s.entity_id));
  const required = (profile.entities && profile.entities.required) || {};

  for (const [key, entityId] of Object.entries(required)) {
    if (!entityId || typeof entityId !== 'string') {
      issues.push(`Missing required mapping: ${key}`);
      continue;
    }
    if (!ids.has(entityId)) {
      issues.push(`Mapped entity not found in HA states: ${key} -> ${entityId}`);
    }
  }

  try {
    const services = await getJson(`${haUrl}/api/services`);
    const hasService = (domain, service) => {
      const d = services.find((x) => x.domain === domain);
      if (!d || !Array.isArray(d.services)) return Boolean(d && d.services && d.services[service]);
      return Boolean(d.services.find((s) => s.service === service));
    };

    if (!hasService('switch', 'turn_on')) issues.push('Missing HA service switch.turn_on');
    if (!hasService('switch', 'turn_off')) issues.push('Missing HA service switch.turn_off');
    if (!hasService('input_number', 'set_value')) issues.push('Missing HA service input_number.set_value');
  } catch (err) {
    issues.push(`Failed to inspect HA services: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!dashboardPath) {
    issues.push('FFT_DASHBOARD_REPO_PATH is not set');
  } else {
    const haConfig = `${dashboardPath}/ha_config`;
    if (!fs.existsSync(haConfig)) {
      issues.push(`Dashboard path missing ha_config: ${haConfig}`);
    }
  }

  const status = issues.length === 0 ? 'pass' : 'fail';
  profile.validation = {
    status,
    timestamp: now,
    issues,
  };

  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

  console.log(`[farm-validate] status=${status}`);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.log(`- ${issue}`);
    }
    process.exit(2);
  }
})().catch((err) => {
  console.error(`[farm-validate] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
NODE
