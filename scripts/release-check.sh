#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Release check: validating skills"
npm run validate:skills

echo "Release check: typecheck"
npm run typecheck

echo "Release check: tests"
npm test

echo "Release check: secret scan"
npm run secret-scan

echo "Release check: npm pack content policy"
npm run pack-check

echo "Release check passed."
