# Farm Mode and Home Assistant

Primary files:
- `src/farm-state-collector.ts`
- `src/farm-action-gateway.ts`
- `src/home-assistant.ts`
- scripts: `scripts/farm-bootstrap.sh`, `scripts/farm-demo.sh`, `scripts/farm-onboarding.sh`, `scripts/farm-validate.sh`

## Farm State Collector

Enabled by `FARM_STATE_ENABLED=true`.

Three loops with independent cadence:
- fast loop (`FARM_STATE_FAST_MS`): states -> `current.json` and telemetry append
- medium loop (`FARM_STATE_MEDIUM_MS`): alert snapshot -> `alerts.json`
- slow loop (`FARM_STATE_SLOW_MS`): devices + calendar -> `devices.json`, `calendar.json`

Output directory:
- `data/farm-state/`

Generated files include:
- `current.json`
- `alerts.json`
- `devices.json`
- `calendar.json`
- `telemetry.ndjson` (daily rotation)
- `screenshots/` (for captured dashboard images)

## Alert and Context Derivation

Collector computes:
- alert list from binary sensors/frost/soil moisture heuristics
- context attributes:
  - `timeOfDay`
  - `season`
  - `weatherCondition`
  - `alertLevel`
  - `suggestedTheme`

Stale mode:
- if HA poll fails, collector writes stale snapshot with `haConnected=false`.

## Farm Action Gateway

Action envelope validated via Zod in `executeFarmAction()`.

Global guards:
1. allowlisted action name
2. main-chat-only execution
3. production control-action gate

Control actions (subject to production gate):
- `ha_call_service`
- `ha_set_entity`
- `ha_restart`
- `ha_apply_dashboard`

Production gate logic:
- if `FARM_MODE=production`, control actions require `FARM_PROFILE_PATH` JSON with `validation.status == "pass"`.

Audit trail:
- every action appends NDJSON record to `data/farm-state/audit.ndjson`.

## Home Assistant Adapter

`HomeAssistantAdapter` wraps HA HTTP API:
- `getAllStates()`
- `getState(entityId)`
- `callService(domain, service, data)`
- `getCalendarEvents(entityId, start, end)`

Auth model:
- bearer token from `HA_TOKEN`

## Farm Bootstrap Scripts

`farm-bootstrap.sh`:
- starts dashboard companion repo stack
- waits for HA reachability
- validates token
- writes farm env vars into `.env`
- runs demo or production flow

Production flow:
1. `farm-onboarding.sh` builds/updates `data/farm-profile.json` mapping
2. `farm-validate.sh` checks mappings and HA services, writes validation status

Demo flow:
- `farm-demo.sh` runs telemetry simulator smoke checks.
