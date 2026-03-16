---
name: fft-demo-holodeck-ops
description: Drive the FFT_demo_dash holodeck system — scene triggers, agent commentary, canvas presets, and live weather mirroring — to produce impactful, context-aware dashboard demos during Telegram interactions.
---

# FFT Demo Holodeck Ops

Use this skill whenever you respond to a farm query and the FFT_demo_dash dashboard is live. Your Telegram reply and the dashboard should update together — the audience sees both simultaneously.

## When to use this skill

- Any time you answer a farm question and the dashboard is running at `http://localhost:8123`.
- When a user asks about conditions, alerts, status, or operational decisions.
- When a scene change would make the answer more visually compelling.
- When showing the dashboard to investors, growers, compliance officers, or press.

## When not to use this skill

- Do not use for production HA deployments with real physical equipment.
- Do not trigger scenes without reading current farm state first.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Keep write operations main-chat-only.
- Always read `current.json` before setting scene entities.

---

## Rule: Always Write Agent Commentary

On every response to a farm query, write two entities before sending your Telegram reply:

**1. Agent status** (short mode label, ≤128 chars):
```json
{
  "type": "farm_action",
  "action": "ha_set_entity",
  "params": {
    "entityId": "input_text.agent_status",
    "value": "Storm Response Active"
  },
  "requestId": "act_<ts>_status"
}
```

**2. Agent commentary** (your full reasoning/answer, ≤500 chars):
```json
{
  "type": "farm_action",
  "action": "ha_set_entity",
  "params": {
    "entityId": "input_text.agent_commentary",
    "value": "NWS shows 68mph gusts arriving in ~3h. Pre-charging battery to 95%. Securing greenhouse vents. Activating storm drainage pumps."
  },
  "requestId": "act_<ts>_commentary"
}
```

The commentary card on the dashboard renders these live with an animated border. The audience sees the agent reasoning in real time.

---

## Scene System

Trigger scenes by setting `input_select.demo_scene` via `ha_call_service`:

```json
{
  "type": "farm_action",
  "action": "ha_call_service",
  "params": {
    "domain": "input_select",
    "service": "select_option",
    "data": {
      "entity_id": "input_select.demo_scene",
      "option": "Golden Hour Harvest"
    }
  },
  "requestId": "act_<ts>_scene"
}
```

### Available Scenes

| Scene Name | When to Use |
|---|---|
| `Golden Hour Harvest` | User asks about yields, harvest timing, solar peak, profitable operations |
| `Morning Irrigation Pulse` | User asks about irrigation, water management, dawn operations |
| `Midnight Ops` | User asks about night security, overnight battery drain, off-hours ops |
| `IPM Zone Lockdown` | User mentions pests, spray schedules, quarantine, Zone B issues |
| `Cannabis Full Bloom` | User asks about grow room status, flower stage, environment setpoints |
| `Fertigation Drift Crisis` | User asks about EC/pH, nutrient dosing, runoff, feed issues |
| `Emergency Cascade` | User mentions storm + security together, asks about emergency protocols |
| `Drone Surveillance Sweep` | User asks about security sweep, perimeter check, anomaly detection |
| `VIP Tour` | User mentions investors, tour, showing the farm, "make it look good" |
| `Compliance Audit Crunch` | User mentions METRC, audits, state inspection, compliance scores |
| `Auto (Weather-Driven)` | Reset to live weather mode after a demo scene |

Each scene: updates theme, 8–20 entity values, writes its own agent_status/commentary automatically.

---

## Canvas Presets

After triggering a scene, optionally load a matching canvas spec for the Agent Canvas view.

Canvas spec files are at `/workspace/dashboard/canvas-specs/` (or the HA www path). Load via:

```json
{
  "type": "farm_action",
  "action": "ha_canvas_set_spec",
  "params": {
    "spec": { "title": "...", "panels": [ ... ] }
  },
  "requestId": "act_<ts>_canvas"
}
```

Or read an existing preset first with `ha_canvas_get_spec`, then patch.

---

## Live Weather Mirroring

The simulator is running live NWS weather for Cedar Creek TX (30.08, -97.49) by default.

To mirror a different city's live weather into a specific zone, use a Telegram-prompted bash call from the host (not IPC) — or tell the user:

```
npm run demo:mirror -- --location nyc --zone greenhouse_a
```

Available locations: `cedar-creek`, `napa-valley`, `nyc`, `nyc-greenhouse`, `seattle`, `miami`, `denver`, `phoenix`, `florida-citrus`
Available zones: `greenhouse_a`, `greenhouse_b`, `greenhouse_c`, `outdoor_north`, `cannabis`

---

## Demo Flow: Farmer Ask → Dashboard Response

Every interaction should follow this sequence:

1. **Read** `/workspace/farm-state/current.json` — get live entity values and suggested theme
2. **Decide** which scene (if any) matches the query context
3. **Write** `agent_status` (mode label)
4. **Write** `agent_commentary` (your answer in ≤500 chars)
5. **Trigger scene** if appropriate (via `input_select.demo_scene`)
6. **Reply via Telegram** — same content as `agent_commentary`, expanded if needed

The dashboard and Telegram reply should tell the same story simultaneously.

---

## Example Interactions

**"Storm coming tomorrow — what should I prepare?"**
- Scene: `Emergency Cascade`
- Status: `Storm Prep Active`
- Commentary: `NWS advisory confirms 65mph gusts, 2.8" rain expected. Pre-charging battery to 95%. Securing vent actuators. Activating storm drainage. Harvest window closes in ~6h.`

**"I'm showing investors in 10 minutes"**
- Scene: `VIP Tour`
- Status: `VIP Mode — All Systems Optimal`
- Commentary: `Solar at 380kW, battery 95%, all compliance at 98%+. Zero active alerts. Yields tracking 12% above projection. Farm is ready for inspection.`

**"Zone B IPM alert just came in"**
- Scene: `IPM Zone Lockdown`
- Status: `IPM Protocol — Zone B Quarantine`
- Commentary: `Pest pressure Zone B: 7.5/10. Room B HVAC isolated to prevent spray drift. Drone launched for survey sweep. Azadirachtin queued. Days since last spray reset.`

**"How's the grow room doing right now?"**
- Read current entities → if nominal, set `Cannabis Full Bloom`
- Status: `Grow Rooms Nominal — All Rooms Flowering`
- Commentary: `PPFD 920, DLI 48, air temp 78°F, RH 52%, CO₂ 1200ppm, EC 2.4, pH 6.0. All rooms in flower at optimal setpoints. Expected yield on track.`
