#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

JSON_OUTPUT="$(npm pack --dry-run --json)"
FOUND="$(printf '%s\n' "$JSON_OUTPUT" | node -e '
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    const arr = JSON.parse(raw);
    const files = (arr[0] && arr[0].files ? arr[0].files : []).map((f) => f.path);
    const forbidden = files.filter((p) => {
      if (
        p.startsWith("groups/") ||
        p.startsWith("dist/release/") ||
        p.startsWith("data/") ||
        p.startsWith("logs/") ||
        p.startsWith("store/") ||
        p.startsWith("tmp/") ||
        p.startsWith("tmp-ipc/") ||
        p.startsWith(".git/")
      ) {
        return true;
      }

      if (p === ".env") return true;
      if (p.startsWith(".env.") && p !== ".env.example") return true;
      return false;
    });
    process.stdout.write(forbidden.join("\n"));
  });
' || true)"

if [[ -n "$FOUND" ]]; then
  echo "ERROR: npm pack would include forbidden paths:"
  echo "$FOUND"
  exit 1
fi

echo "Pack content check passed."
