#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/web.sh [--open]

Notes:
- Prints FFT CONTROL CENTER URL and current reachability.
- --open opens URL in default browser (macOS/Linux desktop only).
USAGE
}

open_browser=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --open)
      open_browser=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

web_host="${FFT_NANO_WEB_HOST:-127.0.0.1}"
web_port="${FFT_NANO_WEB_PORT:-28990}"
show_host="$web_host"
if [[ "$show_host" == "0.0.0.0" || "$show_host" == "::" ]]; then
  show_host="127.0.0.1"
fi

url="http://${show_host}:${web_port}"

header_args=()
if [[ -n "${FFT_NANO_WEB_AUTH_TOKEN:-}" ]]; then
  header_args+=( -H "Authorization: Bearer ${FFT_NANO_WEB_AUTH_TOKEN}" )
fi

status_code="$(curl -sS -o /dev/null -w '%{http_code}' "${header_args[@]}" "${url}/api/runtime/status" || true)"

printf 'FFT CONTROL CENTER\n'
printf 'URL: %s\n' "$url"
case "$status_code" in
  200)
    printf 'Status: reachable (HTTP 200)\n'
    ;;
  401)
    printf 'Status: reachable but auth is required (HTTP 401)\n'
    ;;
  000|'')
    printf 'Status: not reachable (service may be down or web not enabled)\n'
    ;;
  *)
    printf 'Status: reachable with HTTP %s\n' "$status_code"
    ;;
esac

if [[ "$open_browser" -eq 1 ]]; then
  if command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
fi
