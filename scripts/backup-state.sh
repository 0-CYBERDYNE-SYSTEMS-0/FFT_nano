#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/backup-state.sh [--workspace /abs/path] [--out-dir /abs/path] [--name prefix] [--dry-run]

Defaults:
  workspace: $FFT_NANO_MAIN_WORKSPACE_DIR or ~/nano
  out-dir:   ./backups
  name:      fft_nano

Creates a .tar.gz backup that preserves:
  - .env (if present)
  - data/ (if present)
  - groups/ (if present)
  - workspace directory (if present)
USAGE
}

WORKSPACE_DIR="${FFT_NANO_MAIN_WORKSPACE_DIR:-$HOME/nano}"
OUT_DIR="$ROOT_DIR/backups"
NAME_PREFIX="fft_nano"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      [[ $# -ge 2 ]] || { echo "ERROR: --workspace requires a value" >&2; exit 2; }
      WORKSPACE_DIR="$2"
      shift 2
      ;;
    --out-dir)
      [[ $# -ge 2 ]] || { echo "ERROR: --out-dir requires a value" >&2; exit 2; }
      OUT_DIR="$2"
      shift 2
      ;;
    --name)
      [[ $# -ge 2 ]] || { echo "ERROR: --name requires a value" >&2; exit 2; }
      NAME_PREFIX="$2"
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

declare -a tar_args=()
declare -a included=()

add_if_exists() {
  local base_dir="$1"
  local rel_path="$2"
  if [[ -e "$base_dir/$rel_path" ]]; then
    tar_args+=("-C" "$base_dir" "$rel_path")
    included+=("$base_dir/$rel_path")
  fi
}

add_if_exists "$ROOT_DIR" ".env"
add_if_exists "$ROOT_DIR" "data"
add_if_exists "$ROOT_DIR" "groups"

if [[ -d "$WORKSPACE_DIR" ]]; then
  tar_args+=("-C" "$(dirname "$WORKSPACE_DIR")" "$(basename "$WORKSPACE_DIR")")
  included+=("$WORKSPACE_DIR")
fi

if [[ ${#tar_args[@]} -eq 0 ]]; then
  echo "ERROR: no backup sources found (checked .env, data/, groups/, workspace)." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"
archive_path="$OUT_DIR/${NAME_PREFIX}-backup-${timestamp}.tar.gz"

echo "FFT_nano state backup"
echo "  root:      $ROOT_DIR"
echo "  workspace: $WORKSPACE_DIR"
echo "  out:       $archive_path"
echo "  includes:"
for item in "${included[@]}"; do
  echo "    - $item"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run only; archive not created."
  exit 0
fi

tar -czf "$archive_path" "${tar_args[@]}"
echo "Backup complete: $archive_path"

