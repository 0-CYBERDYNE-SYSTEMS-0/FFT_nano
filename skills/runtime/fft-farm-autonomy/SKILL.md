---
name: fft-farm-autonomy
description: Use when activating autonomous farm and cannabis operation control — continuous monitoring, rule-based operational decisions, log-based learning, and dashboard commentary without human prompting each cycle.
---

# FFT Farm Autonomy

Autonomous monitoring loop for the full farm and cannabis operation. Runs continuously, makes allowlisted control decisions independently, escalates only for unknowns and destructive actions.

**Extends:** `fft-farm-ops` (IPC format, allowlist, state file paths) and `fft-demo-holodeck-ops` (commentary write pattern). Read those skills before this one.

---

## Activation

On activation, before starting the loop:

1. Read `/workspace/farm-state/current.json` — establish baseline, note `stale` flag
2. Read last 500 lines of `/workspace/farm-state/telemetry.ndjson` — compute learned baselines (see Log-Based Learning)
3. Read `input_select.incident_mode` — if not `Normal`, jump to Emergency Response before routine loop
4. Write initial commentary (see Commentary Protocol)
5. Set cycle counter to 0

---

## Monitoring Loop

### Condition Tier (~1 min)

Every cycle:

- Read `/workspace/farm-state/current.json`
- Read `/workspace/farm-state/alerts.json`
- Check `input_select.incident_mode`
- If incident mode ≠ Normal → run Emergency Response, then continue
- Apply Decision Logic to current readings
- Write commentary (see Commentary Protocol)
- Increment cycle counter

### Telemetry Tier (~5 min, every 5th cycle)

- Read last 30 rows of `/workspace/farm-state/telemetry.ndjson`
- Compute rolling drift: compare current zone readings against learned baselines
- Flag any value >2σ from baseline as anomalous
- If anomaly is recognized pattern → act autonomously; if novel → escalate

### Camera Tier (~5 min, every 5th cycle)

- Submit `ha_capture_screenshot` for key views (Nexus, Cannabis Executive Portfolio)
- Log visual state to `agent_decision_log`
- Flag visible anomalies (unexpected darkness, smoke, equipment misposition) → escalate

```json
{
  "type": "farm_action",
  "action": "ha_capture_screenshot",
  "params": { "view": "nexus" },
  "requestId": "act_<ts>_cam"
}
```

### Deep Audit (~15 min, every 15th cycle)

- Read `/workspace/farm-state/devices.json` — check device health flags
- Read `/workspace/farm-state/calendar.json` — check upcoming scheduled events
- Full entity scan via `ha_get_status`
- Reconcile actual entity states against expected setpoints
- Correct drift autonomously if within allowlist; escalate otherwise

---

## Decision Logic

Read `input_select.cannabis_active_facility` before any cannabis control action to scope correctly.

| Condition | Autonomous Action | Escalate? |
|-----------|------------------|-----------|
| Soil moisture critically low (<20%) | `switch.turn_on` irrigation pump for that zone | No |
| Temp out of safe band (±5°F from setpoint) | Adjust HVAC setpoint or fan speed via `ha_call_service` | No |
| Storm alert active | `input_select.incident_mode` → `Storm` via `select_option` | No |
| Frost risk detected | Close vents, boost heat to greenhouse zones | No |
| High wind alert | Retract shade cloth, secure vents | No |
| Power failure mode | Reduce non-critical loads via entity disable | No |
| Solar underperforming >15% | Log and notify; do not adjust hardware | Yes |
| Novel anomaly (first occurrence, no historical match) | Notify + propose action, wait for confirmation | Yes |
| Any destructive or irreversible action | Always escalate, never proceed | Yes |

If `current.json` shows `stale: true`, pause control actions — do not act on degraded data. Escalate with staleness context.

---

## Emergency Response Protocol

When `input_select.incident_mode` ≠ `Normal`:

1. Identify active mode: `Storm` / `Intrusion` / `Power Failure`
2. Apply mode-appropriate response before routine checks:
   - **Storm**: Verify vents secured, battery pre-charging, drainage pumps on
   - **Intrusion**: Confirm lighting zones, verify camera capture
   - **Power Failure**: Confirm non-critical loads shed, battery status logged
3. Write commentary with incident context
4. Continue routine loop after emergency checks

---

## Log-Based Learning

On activation and every hour thereafter:

1. Read last 500 lines of `telemetry.ndjson`
2. For each zone metric (soil moisture per zone, greenhouse temps A/B/C, outdoor N/S/E/W, wind, humidity):
   - Compute mean and standard deviation
   - Store as baseline band: `[mean - 2σ, mean + 2σ]`
3. During Telemetry Tier checks, compare current values against stored bands
4. Readings outside the band: flag as anomalous
5. If `/workspace/farm-state/session-history/` exists, read the latest file for prior decision context

Baseline bands update each hour — the loop learns from what it observes.

---

## Commentary Protocol

Write these three entities every condition-tier cycle:

**Agent status** — short mode label (≤128 chars):
```json
{
  "type": "farm_action",
  "action": "ha_set_entity",
  "params": {
    "entityId": "input_text.agent_status",
    "value": "Autonomy: Monitoring · Cycle 14"
  },
  "requestId": "act_<ts>_status"
}
```

**Agent commentary** — one-line reasoning summary (≤500 chars):
```json
{
  "type": "farm_action",
  "action": "ha_set_entity",
  "params": {
    "entityId": "input_text.agent_commentary",
    "value": "All zones nominal. Greenhouse B +3°F drift detected — adjusting setpoint. Battery at 78%, solar tracking forecast."
  },
  "requestId": "act_<ts>_commentary"
}
```

**Decision log** — timestamped last action (≤500 chars):
```json
{
  "type": "farm_action",
  "action": "ha_set_entity",
  "params": {
    "entityId": "input_text.agent_decision_log",
    "value": "2026-02-22T14:03Z — Greenhouse B setpoint adjusted +2°F. Zone South irrigation on (moisture 18%). No alerts."
  },
  "requestId": "act_<ts>_log"
}
```

---

## Safety Guardrails

- Never take destructive or irreversible actions autonomously — always escalate
- Never act on stale data (`stale: true` in `current.json`)
- Never call services outside the `fft-farm-ops` allowlist
- Never bypass incident mode — always resolve emergency checks before routine loop
- Only scope cannabis actions to `input_select.cannabis_active_facility` — never assume facility
- If action result returns `status: error`, surface error and halt that action class until resolved

---

## Deactivation

On deactivation:

1. Write final commentary with cycle count and summary of actions taken
2. Set `input_text.agent_status` to `Autonomy: Standby`
3. Clear `input_text.agent_commentary`
4. Do not revert any operational changes made during the session — document them in `agent_decision_log`
