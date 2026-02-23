#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/restore-state.sh --archive /abs/path/to/backup.tar.gz [--workspace-target /abs/path] [--dry-run]

Restores backup archives created by scripts/backup-state.sh.
This restores repo state (.env, data/, groups/) and a workspace directory.
USAGE
}

ARCHIVE_PATH=""
WORKSPACE_TARGET="${FFT_NANO_MAIN_WORKSPACE_DIR:-$HOME/nano}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || { echo "ERROR: --archive requires a value" >&2; exit 2; }
      ARCHIVE_PATH="$2"
      shift 2
      ;;
    --workspace-target)
      [[ $# -ge 2 ]] || { echo "ERROR: --workspace-target requires a value" >&2; exit 2; }
      WORKSPACE_TARGET="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
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

[[ -n "$ARCHIVE_PATH" ]] || { echo "ERROR: --archive is required" >&2; exit 2; }
[[ -f "$ARCHIVE_PATH" ]] || { echo "ERROR: archive not found: $ARCHIVE_PATH" >&2; exit 1; }

echo "FFT_nano state restore"
echo "  archive: $ARCHIVE_PATH"
echo "  repo:    $ROOT_DIR"
echo "  ws:      $WORKSPACE_TARGET"

echo "Archive entries:"
tar -tzf "$ARCHIVE_PATH" | sed -n '1,80p'

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run only; no files extracted."
  exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

restore_path_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ ! -e "$src" ]]; then
    return
  fi
  mkdir -p "$(dirname "$dst")"
  rm -rf "$dst"
  cp -R "$src" "$dst"
}

restore_path_if_exists "$TMP_DIR/.env" "$ROOT_DIR/.env"
restore_path_if_exists "$TMP_DIR/data" "$ROOT_DIR/data"
restore_path_if_exists "$TMP_DIR/groups" "$ROOT_DIR/groups"

workspace_dir_name="$(basename "$WORKSPACE_TARGET")"
workspace_from_archive="$TMP_DIR/$workspace_dir_name"

if [[ ! -d "$workspace_from_archive" ]]; then
  candidate="$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | awk -F/ '{print $NF}' | grep -vE '^(data|groups)$' | head -n 1 || true)"
  if [[ -n "$candidate" ]]; then
    workspace_from_archive="$TMP_DIR/$candidate"
  fi
fi

if [[ -d "$workspace_from_archive" ]]; then
  mkdir -p "$(dirname "$WORKSPACE_TARGET")"
  rm -rf "$WORKSPACE_TARGET"
  cp -R "$workspace_from_archive" "$WORKSPACE_TARGET"
else
  echo "WARN: workspace directory not found in archive; skipped workspace restore." >&2
fi

echo "Restore complete."
