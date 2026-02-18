#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Running tracked-file secret scan..."

# Block obvious sensitive files from being tracked.
TRACKED_SENSITIVE="$(git ls-files .env '.env.*' '*.p12' '*.pfx' '*.pem' '*id_rsa*' '*id_ed25519*' '*.keys.json' | grep -vE '^\.env\.example$' || true)"
if [[ -n "$TRACKED_SENSITIVE" ]]; then
  echo "ERROR: Sensitive files are tracked:"
  echo "$TRACKED_SENSITIVE"
  exit 1
fi

# High-signal credential patterns.
PATTERN='(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35}|sk_live_[0-9A-Za-z]{16,}|sk_test_[0-9A-Za-z]{16,}|sk-[A-Za-z0-9]{32,}|-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})'

MATCHES="$(git grep -nIE "$PATTERN" -- . ':(exclude)package-lock.json' || true)"
if [[ -n "$MATCHES" ]]; then
  echo "ERROR: Potential hardcoded secrets detected:"
  echo "$MATCHES"
  exit 1
fi

# Block user-specific absolute home paths in tracked files.
PATH_MATCHES="$(git grep -nE '/Users/[A-Za-z0-9._-]+' -- . ':(exclude)package-lock.json' || true)"
PATH_MATCHES="$(echo "$PATH_MATCHES" | grep -Fv '/Users/user' | grep -Fv '/Users/username' | grep -Fv '/Users/yourname' || true)"
if [[ -n "$PATH_MATCHES" ]]; then
  echo "ERROR: Potential personal absolute paths detected:"
  echo "$PATH_MATCHES"
  exit 1
fi

# Block non-placeholder WhatsApp-style chat identifiers in tracked files.
CHAT_ID_MATCHES="$(git grep -nE '[0-9]{10,}(-[0-9]{10,})?@(g\.us|s\.whatsapp\.net)' -- . || true)"
CHAT_ID_MATCHES="$(echo "$CHAT_ID_MATCHES" | grep -Ev '12345@s\.whatsapp\.net|1234567890@s\.whatsapp\.net|1234567890@g\.us|1234567890-1234567890@g\.us' || true)"
if [[ -n "$CHAT_ID_MATCHES" ]]; then
  echo "ERROR: Potential non-placeholder chat identifiers detected:"
  echo "$CHAT_ID_MATCHES"
  exit 1
fi

echo "Secret scan passed."
