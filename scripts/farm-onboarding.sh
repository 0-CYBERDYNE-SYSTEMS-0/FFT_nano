#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HA_URL_INPUT="${HA_URL:-http://localhost:8123}"
TOKEN_INPUT="${HA_TOKEN:-}"
PROFILE_PATH_INPUT="${FARM_PROFILE_PATH:-$ROOT_DIR/data/farm-profile.json}"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/farm-onboarding.sh [--ha-url URL] [--token TOKEN] [--profile-path /abs/path]
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
  read -r -s -p "HA token: " TOKEN_INPUT
  echo
fi
if [[ -z "$TOKEN_INPUT" ]]; then
  echo "HA token is required" >&2
  exit 1
fi

mkdir -p "$(dirname "$PROFILE_PATH_INPUT")"

HA_URL="$HA_URL_INPUT" HA_TOKEN="$TOKEN_INPUT" FARM_PROFILE_PATH="$PROFILE_PATH_INPUT" node <<'NODE'
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const haUrl = process.env.HA_URL;
const haToken = process.env.HA_TOKEN;
const profilePath = process.env.FARM_PROFILE_PATH;

function normalize(s) {
  return String(s || '').toLowerCase();
}

async function fetchStates() {
  const res = await fetch(`${haUrl.replace(/\/$/, '')}/api/states`, {
    headers: { Authorization: `Bearer ${haToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to read HA states: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

const REQUIRED_SPECS = [
  { key: 'irrigation_north', label: 'Irrigation North', patterns: ['switch.irrigation_north'] },
  { key: 'irrigation_south', label: 'Irrigation South', patterns: ['switch.irrigation_south'] },
  { key: 'irrigation_west', label: 'Irrigation West', patterns: ['switch.irrigation_west', 'west_pasture'] },
  { key: 'irrigation_east', label: 'Irrigation East', patterns: ['switch.irrigation_east', 'east_orchard'] },
  { key: 'irrigation_vegetable', label: 'Irrigation Vegetable', patterns: ['switch.irrigation_vegetable', 'vegetable_field'] },
  { key: 'irrigation_nursery', label: 'Irrigation Nursery', patterns: ['switch.irrigation_nursery'] },
  { key: 'pump_main', label: 'Main Pump', patterns: ['switch.pump_main'] },
  { key: 'pump_well_1', label: 'Pump Well 1', patterns: ['switch.pump_well_1', 'input_boolean.pump_well_1'] },
  { key: 'pump_well_2', label: 'Pump Well 2', patterns: ['switch.pump_well_2', 'input_boolean.pump_well_2'] },
  { key: 'tank_main_level', label: 'Main Tank Level', patterns: ['tank_level_main', 'sensor.water_tank_total'] },
  { key: 'tank_secondary_level', label: 'Secondary Tank Level', patterns: ['tank_level_secondary'] },
  { key: 'outdoor_temp', label: 'Outdoor Temperature', patterns: ['sensor.outdoor_temp', 'temperature_outdoor'] },
  { key: 'wind_speed', label: 'Wind Speed', patterns: ['wind_speed'] },
  { key: 'rainfall_today', label: 'Rainfall Today', patterns: ['rainfall_today'] },
  { key: 'critical_alert', label: 'Critical Alert Sensor', patterns: ['storm_alert', 'critical_alert', 'perimeter_alarm'] },
];

function scoreEntity(entityId, patterns) {
  const id = normalize(entityId);
  let score = 0;
  for (const p of patterns) {
    const q = normalize(p);
    if (id === q) score += 8;
    else if (id.includes(q)) score += 3;
  }
  if (id.startsWith('switch.')) score += 0.3;
  if (id.startsWith('sensor.')) score += 0.2;
  if (id.startsWith('binary_sensor.')) score += 0.2;
  if (id.startsWith('input_number.')) score += 0.1;
  return score;
}

function suggest(spec, entityIds) {
  const ranked = entityIds
    .map((id) => ({ id, score: scoreEntity(id, spec.patterns) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (ranked.length === 0) {
    return { best: null, confidence: 0, candidates: [] };
  }
  if (ranked.length === 1) {
    return { best: ranked[0].id, confidence: 0.95, candidates: ranked.slice(0, 5).map((x) => x.id) };
  }
  const gap = ranked[0].score - ranked[1].score;
  const confidence = gap >= 3 ? 0.9 : gap >= 1.5 ? 0.75 : 0.55;
  return { best: ranked[0].id, confidence, candidates: ranked.slice(0, 5).map((x) => x.id) };
}

async function promptUser(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return String(answer || '').trim();
}

(async () => {
  const states = await fetchStates();
  const entityIds = states.map((s) => s.entity_id).filter(Boolean);

  const required = {};
  const confidence = {};

  for (const spec of REQUIRED_SPECS) {
    const s = suggest(spec, entityIds);
    let chosen = s.best;

    if (s.confidence < 0.85) {
      console.log(`\n[map] ${spec.label}`);
      console.log(`  Suggested: ${s.best || '(none)'}`);
      if (s.candidates.length > 0) {
        console.log(`  Top candidates: ${s.candidates.join(', ')}`);
      }
      const ans = await promptUser('  Enter entity_id, press Enter to accept suggestion, or - to skip: ');
      if (ans === '-') chosen = null;
      else if (ans.length > 0) chosen = ans;
    }

    required[spec.key] = chosen || null;
    confidence[spec.key] = Number(s.confidence.toFixed(2));
  }

  const allPresent = Object.values(required).every((v) => typeof v === 'string' && v.length > 0);

  const profile = {
    site: {
      name: 'Farm Site',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      units: 'imperial',
      createdAt: new Date().toISOString(),
    },
    entities: {
      required,
      optional: {
        greenhouse_temp_a: required.outdoor_temp ? null : null,
      },
      confidence,
      discoveredCount: entityIds.length,
    },
    capabilities: {
      irrigationControl: Boolean(required.irrigation_north && required.irrigation_south),
      pumpControl: Boolean(required.pump_main || required.pump_well_1 || required.pump_well_2),
      dashboardApply: true,
      restartHomeAssistant: true,
    },
    validation: {
      status: allPresent ? 'pending' : 'fail',
      timestamp: new Date().toISOString(),
      issues: allPresent ? [] : ['One or more required entities are not mapped.'],
    },
  };

  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

  console.log(`\n[farm-onboarding] wrote profile: ${profilePath}`);
  console.log(`[farm-onboarding] discovered entities: ${entityIds.length}`);
  if (!allPresent) {
    console.log('[farm-onboarding] profile has missing required mappings; validation will fail until completed.');
  }
})().catch((err) => {
  console.error(`[farm-onboarding] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
NODE
