#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <tag> [owner/repo]" >&2
  echo "Example: $0 v1.0.1 0-CYBERDYNE-SYSTEMS-0/FFT_nano" >&2
  exit 2
fi

TAG="$1"
REPO="${2:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "$REPO" ]]; then
  ORIGIN_URL="$(git config --get remote.origin.url || true)"
  if [[ -z "$ORIGIN_URL" ]]; then
    echo "Could not infer repository from origin remote." >&2
    exit 1
  fi
  REPO="$(echo "$ORIGIN_URL" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
fi

OUT_DIR="$ROOT_DIR/dist/release/$TAG"
mkdir -p "$OUT_DIR"

TAR_PATH="$OUT_DIR/${TAG}.tar.gz"
ZIP_PATH="$OUT_DIR/${TAG}.zip"
SUMS_PATH="$OUT_DIR/SHA256SUMS"

curl -fsSL "https://github.com/${REPO}/archive/refs/tags/${TAG}.tar.gz" -o "$TAR_PATH"
curl -fsSL "https://github.com/${REPO}/archive/refs/tags/${TAG}.zip" -o "$ZIP_PATH"

(
  cd "$OUT_DIR"
  shasum -a 256 "$(basename "$TAR_PATH")" "$(basename "$ZIP_PATH")" > "$(basename "$SUMS_PATH")"
)

echo "Wrote:"
echo "  $TAR_PATH"
echo "  $ZIP_PATH"
echo "  $SUMS_PATH"
