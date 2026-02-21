#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${FFT_NANO_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE_NAME="${FFT_NANO_SERVICE_NAME:-fft-nano}"
LAUNCHD_LABEL="${FFT_NANO_LAUNCHD_LABEL:-com.fft_nano}"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
SYSTEMD_UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
LOG_DIR="${PROJECT_ROOT}/logs"
TAIL_LINES="${FFT_NANO_LOG_TAIL_LINES:-120}"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/service.sh install
  ./scripts/service.sh uninstall
  ./scripts/service.sh start
  ./scripts/service.sh stop
  ./scripts/service.sh restart
  ./scripts/service.sh status
  ./scripts/service.sh logs

Notes:
- macOS uses launchd (user LaunchAgent).
- Linux uses systemd service named "fft-nano" by default.
USAGE
}

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    if [[ "${FFT_NANO_NONINTERACTIVE:-0}" == "1" ]] || [[ ! -t 0 ]]; then
      if sudo -n "$@"; then
        return
      fi
      fail "This action needs root privileges. Re-run interactively (or configure passwordless sudo)."
    fi
    sudo "$@"
    return
  fi
  fail "This action requires root privileges and sudo is not available."
}

mac_target() {
  printf 'gui/%s' "$(id -u)"
}

mac_install() {
  mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}"
  cat >"${LAUNCHD_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT_ROOT}/scripts/run-launchd.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/fft_nano.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/fft_nano.error.log</string>
</dict>
</plist>
EOF

  local target
  target="$(mac_target)"
  launchctl bootout "${target}/${LAUNCHD_LABEL}" >/dev/null 2>&1 || true
  launchctl bootstrap "${target}" "${LAUNCHD_PLIST}"
  launchctl kickstart -k "${target}/${LAUNCHD_LABEL}"
  say "Installed and started launchd service: ${LAUNCHD_LABEL}"
}

mac_uninstall() {
  local target
  target="$(mac_target)"
  launchctl bootout "${target}/${LAUNCHD_LABEL}" >/dev/null 2>&1 || true
  rm -f "${LAUNCHD_PLIST}"
  say "Uninstalled launchd service: ${LAUNCHD_LABEL}"
}

mac_start() {
  [[ -f "${LAUNCHD_PLIST}" ]] || fail "Missing ${LAUNCHD_PLIST}. Run install first."
  local target
  target="$(mac_target)"
  launchctl bootstrap "${target}" "${LAUNCHD_PLIST}" >/dev/null 2>&1 || true
  launchctl kickstart -k "${target}/${LAUNCHD_LABEL}"
}

mac_stop() {
  local target
  target="$(mac_target)"
  launchctl bootout "${target}/${LAUNCHD_LABEL}" >/dev/null 2>&1 || true
}

mac_restart() {
  local target
  target="$(mac_target)"
  if launchctl print "${target}/${LAUNCHD_LABEL}" >/dev/null 2>&1; then
    launchctl kickstart -k "${target}/${LAUNCHD_LABEL}"
    return
  fi
  mac_start
}

mac_status() {
  local target
  target="$(mac_target)"
  launchctl print "${target}/${LAUNCHD_LABEL}"
}

mac_logs() {
  mkdir -p "${LOG_DIR}"
  local files=()
  [[ -f "${LOG_DIR}/fft_nano.log" ]] && files+=("${LOG_DIR}/fft_nano.log")
  [[ -f "${LOG_DIR}/fft_nano.error.log" ]] && files+=("${LOG_DIR}/fft_nano.error.log")
  if [[ "${#files[@]}" -eq 0 ]]; then
    say "No launchd logs yet in ${LOG_DIR}."
    return
  fi
  tail -n "${TAIL_LINES}" "${files[@]}"
}

linux_require_systemd() {
  command -v systemctl >/dev/null 2>&1 || fail "systemctl not found. This host does not look like systemd."
}

linux_install() {
  linux_require_systemd
  mkdir -p "${LOG_DIR}"
  local service_user
  service_user="${FFT_NANO_SERVICE_USER:-$(id -un)}"

  local tmp_unit
  tmp_unit="$(mktemp)"
  cat >"${tmp_unit}" <<EOF
[Unit]
Description=FFT_nano
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${service_user}
WorkingDirectory=${PROJECT_ROOT}
ExecStart=/usr/bin/env bash ${PROJECT_ROOT}/scripts/start.sh start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  run_privileged install -m 0644 "${tmp_unit}" "${SYSTEMD_UNIT_PATH}"
  rm -f "${tmp_unit}"
  run_privileged systemctl daemon-reload
  run_privileged systemctl enable --now "${SERVICE_NAME}"
  say "Installed and started systemd service: ${SERVICE_NAME}"
}

linux_uninstall() {
  linux_require_systemd
  run_privileged systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
  run_privileged rm -f "${SYSTEMD_UNIT_PATH}"
  run_privileged systemctl daemon-reload
  say "Uninstalled systemd service: ${SERVICE_NAME}"
}

linux_start() {
  linux_require_systemd
  run_privileged systemctl start "${SERVICE_NAME}"
}

linux_stop() {
  linux_require_systemd
  run_privileged systemctl stop "${SERVICE_NAME}"
}

linux_restart() {
  linux_require_systemd
  if systemctl restart "${SERVICE_NAME}" >/dev/null 2>&1; then
    return
  fi

  # Gateway-triggered restart from inside the running service can self-terminate.
  # The unit is configured with Restart=always, so PID 1 starts a new process.
  if [[ "${FFT_NANO_GATEWAY_CALL:-0}" == "1" ]]; then
    local main_pid
    main_pid="$(systemctl show "${SERVICE_NAME}" -p MainPID --value 2>/dev/null || true)"
    if [[ -n "${main_pid}" ]] && [[ "${main_pid}" == "${PPID}" ]]; then
      say "Restarting ${SERVICE_NAME} by terminating main process (${main_pid})."
      kill -TERM "${main_pid}"
      return
    fi
  fi

  run_privileged systemctl restart "${SERVICE_NAME}"
}

linux_status() {
  linux_require_systemd
  if systemctl status "${SERVICE_NAME}" --no-pager; then
    return
  fi
  run_privileged systemctl status "${SERVICE_NAME}" --no-pager
}

linux_logs() {
  linux_require_systemd
  if journalctl -u "${SERVICE_NAME}" -n "${TAIL_LINES}" --no-pager; then
    return
  fi
  run_privileged journalctl -u "${SERVICE_NAME}" -n "${TAIL_LINES}" --no-pager
}

main() {
  local action="${1:-status}"
  case "${action}" in
    -h|--help|help)
      usage
      exit 0
      ;;
    install|uninstall|start|stop|restart|status|logs)
      ;;
    *)
      fail "Unknown action: ${action}"
      ;;
  esac

  local platform
  platform="$(uname -s)"
  case "${platform}" in
    Darwin)
      "mac_${action}"
      ;;
    Linux)
      "linux_${action}"
      ;;
    *)
      fail "Unsupported platform: ${platform}"
      ;;
  esac
}

main "$@"
