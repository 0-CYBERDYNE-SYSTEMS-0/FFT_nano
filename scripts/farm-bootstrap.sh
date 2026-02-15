#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="demo"
DASH_PATH=""
HA_URL_INPUT="http://localhost:8123"
OPEN_BROWSER="yes"
TOKEN_INPUT=""
PROFILE_PATH_DEFAULT="$ROOT_DIR/data/farm-profile.json"
COMPANION_REPO="${FFT_DASHBOARD_REPO_URL:-https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_demo_dash.git}"
COMPANION_REF="${FFT_DASHBOARD_REPO_REF:-dee8fc890845825a4e77c189ef6b6ab64676baed}"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/farm-bootstrap.sh --mode demo|production [--dash-path /abs/path] [--ha-url URL] [--open-browser yes|no] [--token TOKEN] [--companion-repo URL] [--companion-ref REF]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"; shift 2 ;;
    --dash-path)
      DASH_PATH="${2:-}"; shift 2 ;;
    --ha-url)
      HA_URL_INPUT="${2:-}"; shift 2 ;;
    --open-browser)
      OPEN_BROWSER="${2:-}"; shift 2 ;;
    --token)
      TOKEN_INPUT="${2:-}"; shift 2 ;;
    --companion-repo)
      COMPANION_REPO="${2:-}"; shift 2 ;;
    --companion-ref)
      COMPANION_REF="${2:-}"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2 ;;
  esac
done

if [[ "$MODE" != "demo" && "$MODE" != "production" ]]; then
  echo "--mode must be demo or production" >&2
  exit 2
fi

if [[ -z "$DASH_PATH" ]]; then
  if [[ -d "$HOME/FFT_demo_dash" ]]; then
    DASH_PATH="$HOME/FFT_demo_dash"
  elif [[ -d "$HOME/fft_demo_dash" ]]; then
    DASH_PATH="$HOME/fft_demo_dash"
  else
    DASH_PATH="$HOME/FFT_demo_dash"
  fi
fi

ENV_FILE="$ROOT_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
fi

env_upsert() {
  local file="$1" key="$2" value="$3"
  local tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { done=0 }
    $0 ~ ("^" k "=") {
      if (!done) {
        print k "=" v;
        done=1;
      }
      next;
    }
    { print }
    END {
      if (!done) print k "=" v;
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

compose_up() {
  if docker compose version >/dev/null 2>&1; then
    docker compose up -d
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose up -d
  else
    echo "Docker Compose not found (need docker compose plugin or docker-compose binary)." >&2
    return 1
  fi
}

open_url() {
  local url="$1"
  if [[ "$OPEN_BROWSER" != "yes" ]]; then
    echo "Open this URL: $url"
    return 0
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
    return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
    return 0
  fi
  echo "Open this URL: $url"
}

sync_companion_repo() {
  local repo_url="$1" repo_path="$2" repo_ref="$3"
  mkdir -p "$(dirname "$repo_path")"

  if [[ ! -d "$repo_path/.git" ]]; then
    echo "[farm-bootstrap] cloning dashboard companion repo"
    git clone "$repo_url" "$repo_path"
  fi

  if [[ -n "$(git -C "$repo_path" status --porcelain)" ]]; then
    echo "[farm-bootstrap] dashboard repo has local changes; skipping auto-sync and using current checkout"
    return 0
  fi

  git -C "$repo_path" fetch origin --prune
  if [[ "$repo_ref" =~ ^[0-9a-f]{40}$ ]]; then
    git -C "$repo_path" fetch origin "$repo_ref" || true
    git -C "$repo_path" checkout --detach "$repo_ref"
  else
    git -C "$repo_path" checkout "$repo_ref"
    git -C "$repo_path" pull --ff-only origin "$repo_ref"
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for Home Assistant stack in this setup. Install Docker and retry." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not reachable. Start Docker and retry." >&2
  exit 1
fi

mkdir -p "$ROOT_DIR/data"
sync_companion_repo "$COMPANION_REPO" "$DASH_PATH" "$COMPANION_REF"

echo "[farm-bootstrap] Starting Home Assistant stack in $DASH_PATH"
(
  cd "$DASH_PATH"
  compose_up
)

echo "[farm-bootstrap] Waiting for HA at $HA_URL_INPUT"
ready=0
for _ in $(seq 1 60); do
  if curl -fsS -m 3 "$HA_URL_INPUT" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" -ne 1 ]]; then
  echo "Home Assistant did not become reachable at $HA_URL_INPUT" >&2
  exit 1
fi

open_url "$HA_URL_INPUT"
open_url "$HA_URL_INPUT/profile"

token="$TOKEN_INPUT"
if [[ -z "$token" ]]; then
  echo "Create a Long-Lived Access Token in Home Assistant profile, then paste it below."
  read -r -s -p "HA token: " token
  echo
fi
if [[ -z "$token" ]]; then
  echo "Token is required." >&2
  exit 1
fi

status_code="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "$HA_URL_INPUT/api/" || true)"
if [[ "$status_code" != "200" ]]; then
  echo "Token validation failed (HTTP $status_code)." >&2
  exit 1
fi

env_upsert "$ENV_FILE" "FARM_MODE" "$MODE"
env_upsert "$ENV_FILE" "FARM_PROFILE_PATH" "$PROFILE_PATH_DEFAULT"
env_upsert "$ENV_FILE" "FARM_STATE_ENABLED" "true"
env_upsert "$ENV_FILE" "HA_URL" "$HA_URL_INPUT"
env_upsert "$ENV_FILE" "HA_TOKEN" "$token"
env_upsert "$ENV_FILE" "FFT_DASHBOARD_REPO_PATH" "$DASH_PATH"
env_upsert "$ENV_FILE" "FFT_DASHBOARD_REPO_URL" "$COMPANION_REPO"
env_upsert "$ENV_FILE" "FFT_DASHBOARD_REPO_REF" "$COMPANION_REF"

echo "[farm-bootstrap] Updated $ENV_FILE"

if [[ "$MODE" == "demo" ]]; then
  "$ROOT_DIR/scripts/farm-demo.sh" --dash-path "$DASH_PATH" --ha-url "$HA_URL_INPUT" --token "$token"
else
  "$ROOT_DIR/scripts/farm-onboarding.sh" --ha-url "$HA_URL_INPUT" --token "$token" --profile-path "$PROFILE_PATH_DEFAULT"
  "$ROOT_DIR/scripts/farm-validate.sh" --ha-url "$HA_URL_INPUT" --token "$token" --profile-path "$PROFILE_PATH_DEFAULT"
fi

echo "[farm-bootstrap] complete (mode=$MODE)"
