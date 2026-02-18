# Farm Onboarding: Demo vs Production

Users install only `FFT_nano`. The setup flow auto-manages dashboard templates from the companion repository (`FFT_demo_dash`) and adapts mappings to discovered Home Assistant entities.

## Quickstart

### Demo Mode (fast showcase)

```bash
./scripts/farm-bootstrap.sh --mode demo
```

What this does:
- Auto-clones/pulls companion dashboard templates (when repo is clean).
- Starts Home Assistant stack from the managed dashboard path.
- Guides token setup in browser.
- Wires `.env` values for farm bridge.
- Runs demo checks and simulator smoke test.

### Production Mode (real devices)

```bash
./scripts/farm-bootstrap.sh --mode production
```

What this does:
- Starts Home Assistant stack.
- Opens HA UI/profile for token generation.
- Runs entity discovery + mapping suggestion (`farm-onboarding.sh`) using HA `/api/states`.
- Requests confirmation for uncertain mappings.
- Runs readiness validation (`farm-validate.sh`).
- Writes `data/farm-profile.json` and stamps validation status.

## Bootstrap CLI Contract

```bash
./scripts/farm-bootstrap.sh \
  --mode demo|production \
  --dash-path /abs/path \
  --ha-url http://localhost:8123 \
  --open-browser yes|no \
  --token <optional> \
  --companion-repo https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_demo_dash.git \
  --companion-ref <branch-or-sha>
```

Companion pin behavior:
- `--companion-ref` or `FFT_DASHBOARD_REPO_REF` can be a branch/tag/SHA.
- SHA values are checked out in detached mode for deterministic deployments.

## Control Safety Gate

In `FARM_MODE=production`, control actions are blocked unless:
- `FARM_PROFILE_PATH` exists, and
- `validation.status` in profile is `pass`.

Blocked control actions before pass:
- `ha_call_service`
- `ha_set_entity`
- `ha_restart`
- `ha_apply_dashboard`

Read actions remain allowed, including:
- `ha_get_status`
- `ha_capture_screenshot`
- `farm_state_refresh`

## Troubleshooting

### Docker daemon unavailable
- Start Docker Desktop (macOS) or Docker daemon (Linux).
- Re-run bootstrap.

### Home Assistant not reachable at `HA_URL`
- Check compose logs in dashboard repo:
  - `docker compose logs -f homeassistant`
  - or `docker-compose logs -f homeassistant`

### Token validation fails
- Open `http://localhost:8123/profile`
- Create a new long-lived access token.
- Re-run bootstrap or onboarding with `--token`.

### Validation fails due to missing mappings
- Re-run onboarding and fill missing required entities:
  - `./scripts/farm-onboarding.sh`
- Re-run validation:
  - `./scripts/farm-validate.sh`

### Dashboard path errors
- Ensure `FFT_DASHBOARD_REPO_PATH` points to repo containing:
  - `ha_config/`
  - `dashboard-templates/`

## Launch Status Reference

Canonical public launch truth report:
- `/absolute/path/to/LAUNCH_TRUTH_REPORT.md`
