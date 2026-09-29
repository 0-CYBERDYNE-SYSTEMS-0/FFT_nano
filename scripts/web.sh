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
- --open opens URL in the default browser.
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

is_termux() {
  [[ -n "${TERMUX_VERSION:-}" ]] || [[ "${PREFIX:-}" == *com.termux* ]] || [[ -d /data/data/com.termux/files/usr ]]
}

wait_for_termux_web() {
  local waited=0
  local timeout_seconds="${FFT_NANO_READY_TIMEOUT_SECONDS:-30}"

  while (( waited < timeout_seconds )); do
    if curl -sS -o /dev/null --max-time 2 "${url}/api/health" 2>/dev/null; then
      return 0
    fi
    sleep 1
    ((waited += 1))
  done

  return 1
}

ensure_termux_web_service() {
  local service_status
  if ! service_status="$(bash "${ROOT_DIR}/scripts/service.sh" status)"; then
    printf 'ERROR: Could not determine the Termux service status. Run `fft service status`.\n' >&2
    return 1
  fi

  case "${service_status}" in
    running)
      ;;
    stopped)
      if ! bash "${ROOT_DIR}/scripts/service.sh" start; then
        printf 'ERROR: Could not start the Termux service. Run `fft service start`.\n' >&2
        return 1
      fi
      ;;
    not_installed)
      printf 'ERROR: The Termux service is not installed. Run `fft service install` first.\n' >&2
      return 1
      ;;
    *)
      printf 'ERROR: Unexpected Termux service status: %s\n' "${service_status}" >&2
      return 1
      ;;
  esac

  if ! wait_for_termux_web; then
    printf 'ERROR: FFT Control Center did not become ready at %s within %ss. Run `fft service logs`.\n' "${url}" "${FFT_NANO_READY_TIMEOUT_SECONDS:-30}" >&2
    return 1
  fi
}

if is_termux; then
  ensure_termux_web_service || exit 1
  status_code="200"
elif [[ -n "${FFT_NANO_WEB_AUTH_TOKEN:-}" ]]; then
  status_code="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${FFT_NANO_WEB_AUTH_TOKEN}" "${url}/api/runtime/status" || true)"
else
  status_code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}/api/runtime/status" || true)"
fi
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
  if is_termux; then
    if ! command -v termux-open-url >/dev/null 2>&1; then
      printf 'ERROR: termux-open-url is unavailable. Open %s in your Android browser.\n' "$url" >&2
      exit 1
    fi
    if ! termux-open-url "$url"; then
      printf 'ERROR: Could not open the Android browser. Open %s manually.\n' "$url" >&2
      exit 1
    fi
  elif command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
fi
