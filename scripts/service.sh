#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${FFT_NANO_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE_NAME="${FFT_NANO_SERVICE_NAME:-fft-nano}"
LAUNCHD_LABEL="${FFT_NANO_LAUNCHD_LABEL:-com.fft_nano}"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
SYSTEMD_UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
LOG_DIR="${PROJECT_ROOT}/logs"
TAIL_LINES="${FFT_NANO_LOG_TAIL_LINES:-120}"

# Termux/Termux-services paths
TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
TERMUX_SERVICE_DIR="${TERMUX_PREFIX}/var/service/${SERVICE_NAME}"
TERMUX_LOG_DIR="${TERMUX_PREFIX}/var/log/${SERVICE_NAME}"

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

mac_service_ref() {
  printf '%s/%s' "$(mac_target)" "${LAUNCHD_LABEL}"
}

mac_is_loaded() {
  launchctl print "$(mac_service_ref)" >/dev/null 2>&1
}

mac_wait_unloaded() {
  local attempts="${1:-30}"
  while mac_is_loaded; do
    ((attempts--)) || return 1
    sleep 0.1
  done
}

mac_bootout_loaded_job() {
  local target service_ref
  target="$(mac_target)"
  service_ref="$(mac_service_ref)"

  # Use domain+plist form first: this reliably unloads stale launchd jobs.
  launchctl bootout "${target}" "${LAUNCHD_PLIST}" >/dev/null 2>&1 || true
  if mac_wait_unloaded 30; then
    return
  fi

  # Fallback for older launchd behavior where only the service ref unloads.
  launchctl bootout "${service_ref}" >/dev/null 2>&1 || true
  mac_wait_unloaded 30 || true
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

  local target service_ref bootstrap_out bootstrap_ok
  target="$(mac_target)"
  service_ref="$(mac_service_ref)"
  mac_bootout_loaded_job

  bootstrap_out=""
  bootstrap_ok=0
  for _ in 1 2 3 4 5; do
    if bootstrap_out="$(launchctl bootstrap "${target}" "${LAUNCHD_PLIST}" 2>&1)"; then
      bootstrap_ok=1
      break
    fi
    if mac_is_loaded; then
      bootstrap_ok=1
      break
    fi
    mac_bootout_loaded_job
    sleep 0.25
  done
  [[ "${bootstrap_ok}" -eq 1 ]] || fail "launchctl bootstrap failed: ${bootstrap_out}"
  launchctl kickstart -k "${service_ref}"
  say "Installed and started launchd service: ${LAUNCHD_LABEL}"
}

mac_uninstall() {
  mac_bootout_loaded_job
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
  mac_bootout_loaded_job
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

mac_pid() {
  local target pid
  target="$(mac_target)"
  pid="$(launchctl print "${target}/${LAUNCHD_LABEL}" 2>/dev/null | sed -n 's/^[[:space:]]*pid = \([0-9]*\).*/\1/p' | head -1)"
  if [[ -z "${pid}" || "${pid}" == "0" ]]; then
    pid="$(pgrep -f "${PROJECT_ROOT}/dist/index.js" 2>/dev/null | head -1 || true)"
  fi
  [[ -n "${pid}" && "${pid}" != "0" ]] && printf '%s\n' "${pid}"
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

# Detect init system: systemd, openrc, or runit
linux_detect_init() {
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    printf 'systemd'
    return
  fi
  if [[ -x /sbin/openrc-run ]] || [[ -x /usr/sbin/openrc-run ]]; then
    printf 'openrc'
    return
  fi
  if [[ -d /run/runit ]] || [[ -d /var/service ]]; then
    printf 'runit'
    return
  fi
  printf 'unknown'
}

linux_install() {
  local init_system
  init_system="$(linux_detect_init)"
  mkdir -p "${LOG_DIR}"

  case "${init_system}" in
    systemd)
      linux_install_systemd
      ;;
    openrc)
      openrc_install
      openrc_start
      ;;
    runit)
      runit_install
      runit_start
      ;;
    *)
      fail "Unsupported init system: ${init_system}. Only systemd, OpenRC, and runit are supported."
      ;;
  esac
}

linux_uninstall() {
  local init_system
  init_system="$(linux_detect_init)"

  case "${init_system}" in
    systemd)
      linux_uninstall_systemd
      ;;
    openrc)
      openrc_uninstall
      ;;
    runit)
      runit_uninstall
      ;;
    *)
      fail "Unsupported init system: ${init_system}"
      ;;
  esac
}

linux_install_systemd() {
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

linux_uninstall_systemd() {
  run_privileged systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
  run_privileged rm -f "${SYSTEMD_UNIT_PATH}"
  run_privileged systemctl daemon-reload
  say "Uninstalled systemd service: ${SERVICE_NAME}"
}

linux_start() {
  local init_system
  init_system="$(linux_detect_init)"

  case "${init_system}" in
    systemd)
      run_privileged systemctl start "${SERVICE_NAME}"
      ;;
    openrc)
      openrc_start
      ;;
    runit)
      runit_start
      ;;
    *)
      fail "Unsupported init system: ${init_system}"
      ;;
  esac
}

linux_stop() {
  local init_system
  init_system="$(linux_detect_init)"

  case "${init_system}" in
    systemd)
      run_privileged systemctl stop "${SERVICE_NAME}"
      ;;
    openrc)
      openrc_stop
      ;;
    runit)
      runit_stop
      ;;
    *)
      fail "Unsupported init system: ${init_system}"
      ;;
  esac
}

linux_restart() {
  local init_system
  init_system="$(linux_detect_init)"

  case "${init_system}" in
    systemd)
      linux_restart_systemd
      ;;
    openrc)
      openrc_restart
      ;;
    runit)
      runit_restart
      ;;
    *)
      fail "Unsupported init system: ${init_system}"
      ;;
  esac
}

linux_restart_systemd() {
  if [[ "${FFT_NANO_GATEWAY_CALL:-0}" == "1" ]]; then
    if systemctl restart --no-block "${SERVICE_NAME}" >/dev/null 2>&1; then
      say "Queued restart for ${SERVICE_NAME}."
      return
    fi
  fi

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

linux_pid() {
  local init_system pid
  init_system="$(linux_detect_init)"
  pid=""
  if [[ "${init_system}" == "systemd" ]]; then
    pid="$(systemctl show -p MainPID --value "${SERVICE_NAME}" 2>/dev/null || true)"
  fi
  if [[ -z "${pid}" || "${pid}" == "0" ]]; then
    pid="$(pgrep -f "${PROJECT_ROOT}/dist/index.js" 2>/dev/null | head -1 || true)"
  fi
  [[ -n "${pid}" && "${pid}" != "0" ]] && printf '%s\n' "${pid}"
}

linux_status() {
  local init_system
  init_system="$(linux_detect_init)"

  case "${init_system}" in
    systemd)
      if systemctl status "${SERVICE_NAME}" --no-pager; then
        return
      fi
      run_privileged systemctl status "${SERVICE_NAME}" --no-pager
      ;;
    openrc)
      openrc_status
      ;;
    runit)
      runit_status
      ;;
    *)
      fail "Unsupported init system: ${init_system}"
      ;;
  esac
}

linux_logs() {
  local init_system
  init_system="$(linux_detect_init)"

  case "${init_system}" in
    systemd)
      if journalctl -u "${SERVICE_NAME}" -n "${TAIL_LINES}" --no-pager; then
        return
      fi
      run_privileged journalctl -u "${SERVICE_NAME}" -n "${TAIL_LINES}" --no-pager
      ;;
    openrc)
      openrc_logs
      ;;
    runit)
      runit_logs
      ;;
    *)
      fail "Unsupported init system: ${init_system}"
      ;;
  esac
}

# ---- OpenRC (Alpine, Gentoo, etc.) ----

OPENRC_SERVICE_DIR="/etc/init.d"
OPENRC_RUN_DIR="/run/openrc"

openrc_install() {
  mkdir -p "${LOG_DIR}"
  local service_user
  service_user="${FFT_NANO_SERVICE_USER:-$(id -un)}"

  # Create OpenRC init script
  cat >"${OPENRC_SERVICE_DIR}/${SERVICE_NAME}" <<EOF
#!/sbin/openrc-run
name="${SERVICE_NAME}"
description="FFT_nano"
command="${PROJECT_ROOT}/scripts/start.sh"
command_args="start"
command_user="${service_user}"
output_log="${LOG_DIR}/fft_nano.log"
error_log="${LOG_DIR}/fft_nano.error.log"
pidfile="/run/${SERVICE_NAME}.pid"
retry="5"
supervisor="supervise-daemon"

depend() {
  need net
  after firewall
}
EOF

  chmod +x "${OPENRC_SERVICE_DIR}/${SERVICE_NAME}"
  rc-update add "${SERVICE_NAME}" default 2>/dev/null || true
  say "Installed OpenRC service: ${SERVICE_NAME}"
}

openrc_uninstall() {
  rc-update del "${SERVICE_NAME}" default 2>/dev/null || true
  rm -f "${OPENRC_SERVICE_DIR}/${SERVICE_NAME}"
  rm -f "/run/${SERVICE_NAME}.pid"
  say "Uninstalled OpenRC service: ${SERVICE_NAME}"
}

openrc_start() {
  rc-service "${SERVICE_NAME}" start
}

openrc_stop() {
  rc-service "${SERVICE_NAME}" stop
}

openrc_restart() {
  rc-service "${SERVICE_NAME}" restart
}

openrc_status() {
  rc-service "${SERVICE_NAME}" status
}

openrc_logs() {
  if [[ -f "${LOG_DIR}/fft_nano.log" ]]; then
    tail -n "${TAIL_LINES}" "${LOG_DIR}/fft_nano.log"
  else
    echo "(no logs)"
  fi
}

# ---- runit (Void, Alpine with runit, etc.) ----

RUNIT_SERVICE_DIR="/etc/sv"
RUNIT_RUN_DIR="/var/service"

runit_install() {
  mkdir -p "${LOG_DIR}" "${RUNIT_SERVICE_DIR}/${SERVICE_NAME}/log" "${RUNIT_SERVICE_DIR}/${SERVICE_NAME}/log/main"

  local service_user
  service_user="${FFT_NANO_SERVICE_USER:-$(id -un)}"

  # Create run script
  cat >"${RUNIT_SERVICE_DIR}/${SERVICE_NAME}/run" <<EOF
#!/bin/sh
exec 2>&1
exec chpst -u "${service_user}" ${PROJECT_ROOT}/scripts/start.sh start
EOF

  # Create log run script
  cat >"${RUNIT_SERVICE_DIR}/${SERVICE_NAME}/log/run" <<EOF
#!/bin/sh
exec svlogd -tt "${LOG_DIR}"
EOF

  chmod +x "${RUNIT_SERVICE_DIR}/${SERVICE_NAME}/run" "${RUNIT_SERVICE_DIR}/${SERVICE_NAME}/log/run"

  # Enable the service (symlink to /var/service for systems that use it)
  if [[ -d "${RUNIT_RUN_DIR}" ]] && [[ ! -L "${RUNIT_RUN_DIR}/${SERVICE_NAME}" ]]; then
    ln -sf "${RUNIT_SERVICE_DIR}/${SERVICE_NAME}" "${RUNIT_RUN_DIR}/${SERVICE_NAME}"
  fi

  say "Installed runit service: ${SERVICE_NAME}"
}

runit_uninstall() {
  sv stop "${SERVICE_NAME}" 2>/dev/null || true
  rm -rf "${RUNIT_SERVICE_DIR}/${SERVICE_NAME}"
  rm -f "${RUNIT_RUN_DIR}/${SERVICE_NAME}" 2>/dev/null || true
  say "Uninstalled runit service: ${SERVICE_NAME}"
}

runit_start() {
  sv start "${SERVICE_NAME}"
}

runit_stop() {
  sv stop "${SERVICE_NAME}"
}

runit_restart() {
  sv restart "${SERVICE_NAME}"
}

runit_status() {
  sv status "${SERVICE_NAME}"
}

runit_logs() {
  sv log "${SERVICE_NAME}" 2>/dev/null || {
    if [[ -f "${LOG_DIR}/fft_nano.log" ]]; then
      tail -n "${TAIL_LINES}" "${LOG_DIR}/fft_nano.log"
    else
      echo "(no logs)"
    fi
  }
}

# ---- Termux / Android ----

is_termux() {
  [[ -n "${TERMUX_VERSION:-}" ]] || [[ "${PREFIX:-}" == *com.termux* ]] || [[ -d /data/data/com.termux/files/usr ]]
}

termux_service_exists() {
  [[ -d "${TERMUX_SERVICE_DIR}" ]]
}

termux_pid() {
  local pid
  pid="$(pgrep -f "${PROJECT_ROOT}/dist/index.js" 2>/dev/null | head -1 || true)"
  [[ -n "${pid}" && "${pid}" != "0" ]] && printf '%s\n' "${pid}"
}

termux_install() {
  if ! is_termux; then
    fail "termux-services is only available on Android/Termux"
  fi

  # termux-services is required for sv/run-script to manage the daemon.
  if ! command -v sv >/dev/null 2>&1; then
    if [[ "${FFT_NANO_NONINTERACTIVE:-0}" == "1" ]] || [[ ! -t 0 ]]; then
      fail "termux-services is not installed. Install it interactively with 'pkg install termux-services' before running install."
    fi
    say "termux-services is not installed; attempting: pkg install termux-services"
    if ! pkg install -y termux-services; then
      fail "Failed to install termux-services. Re-run with --no-install-daemon to skip, or install it interactively with 'pkg install termux-services'."
    fi
  fi

  mkdir -p "${TERMUX_SERVICE_DIR}/log" "${TERMUX_LOG_DIR}" "${LOG_DIR}"

  # The run script must source .env and call scripts/start.sh start so
  # TUI defaults, runtime selection, and TELEGRAM_BOT_TOKEN resolution
  # match the foreground path. Do NOT exec node dist/index.js directly:
  # the gateway startup would skip the .env defaults and would not be
  # consistent with `scripts/service.sh` on other platforms.
  cat >"${TERMUX_SERVICE_DIR}/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
cd ${PROJECT_ROOT}
exec ${PROJECT_ROOT}/scripts/start.sh start >> ${TERMUX_LOG_DIR}/stdout.log 2>> ${TERMUX_LOG_DIR}/stderr.log
EOF

  # Forward daemon logs to logcat as well, in addition to the on-disk files.
  cat >"${TERMUX_SERVICE_DIR}/log/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec svlogd -tt ${TERMUX_LOG_DIR}
EOF

  chmod +x "${TERMUX_SERVICE_DIR}/run" "${TERMUX_SERVICE_DIR}/log/run"
  say "Installed termux-services service: ${SERVICE_NAME}"
}

termux_uninstall() {
  if ! is_termux; then
    fail "termux-services is only available on Android/Termux"
  fi

  termux_stop

  rm -rf "${TERMUX_SERVICE_DIR}" 2>/dev/null || true
  rm -rf "${TERMUX_LOG_DIR}" 2>/dev/null || true
  say "Uninstalled termux-services service: ${SERVICE_NAME}"
}

termux_start() {
  if ! is_termux; then
    fail "termux-services is only available on Android/Termux"
  fi

  if ! termux_service_exists; then
    fail "Service not installed. Run install first."
  fi

  sv up "${SERVICE_NAME}"
  say "Started termux-services service: ${SERVICE_NAME}"
}

termux_stop() {
  if ! is_termux; then
    return 0
  fi

  if termux_service_exists; then
    sv down "${SERVICE_NAME}" 2>/dev/null || true
  fi
}

termux_restart() {
  if ! is_termux; then
    fail "termux-services is only available on Android/Termux"
  fi

  if ! termux_service_exists; then
    fail "Service not installed. Run install first."
  fi

  sv restart "${SERVICE_NAME}"
  say "Restarted termux-services service: ${SERVICE_NAME}"
}

termux_status() {
  if ! is_termux; then
    echo "not_termux"
    return
  fi

  if ! termux_service_exists; then
    echo "not_installed"
    return
  fi

  if sv status "${SERVICE_NAME}" 2>/dev/null | grep -q "run"; then
    echo "running"
  else
    echo "stopped"
  fi
}

termux_logs() {
  if ! is_termux; then
    echo "not_termux"
    return
  fi

  mkdir -p "${TERMUX_LOG_DIR}"

  if [[ -f "${TERMUX_LOG_DIR}/current" ]] || compgen -G "${TERMUX_LOG_DIR}/*" >/dev/null; then
    # svlogd rotates logs into timestamped files. Tail the most recent.
    local latest
    latest="$(ls -1t "${TERMUX_LOG_DIR}" 2>/dev/null | head -1 || true)"
    if [[ -n "${latest}" ]] && [[ -f "${TERMUX_LOG_DIR}/${latest}" ]]; then
      tail -n "${TAIL_LINES}" "${TERMUX_LOG_DIR}/${latest}"
      return
    fi
  fi

  if [[ -f "${TERMUX_LOG_DIR}/stdout.log" ]]; then
    echo "=== stdout ==="
    tail -n "${TAIL_LINES}" "${TERMUX_LOG_DIR}/stdout.log"
  fi
  if [[ -f "${TERMUX_LOG_DIR}/stderr.log" ]]; then
    echo "=== stderr ==="
    tail -n "${TAIL_LINES}" "${TERMUX_LOG_DIR}/stderr.log"
  fi
  if [[ ! -f "${TERMUX_LOG_DIR}/stdout.log" ]] && [[ ! -f "${TERMUX_LOG_DIR}/stderr.log" ]]; then
    echo "(no logs)"
  fi
}

main() {
  local action="${1:-status}"
  case "${action}" in
    -h|--help|help)
      usage
      exit 0
      ;;
    install|uninstall|start|stop|restart|status|logs|pid)
      ;;
    *)
      fail "Unknown action: ${action}"
      ;;
  esac

  local platform
  platform="$(uname -s)"

  # Android/Termux uses termux-services
  if [[ "${platform}" == "Linux" ]] && is_termux; then
    "termux_${action}"
    return
  fi

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
