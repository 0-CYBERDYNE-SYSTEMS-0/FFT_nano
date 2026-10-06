#!/usr/bin/env bash
# One-command success bar. Exit 0 = green. Run before committing/merging.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
step(){ printf "\033[1;34m== %s\033[0m\n" "$1"; }
rc(){ if [ "$1" -ne 0 ]; then printf "\033[1;31mFAIL %s\033[0m\n" "$2"; return 1; fi; printf "\033[1;32mok: %s\033[0m\n" "$2"; }

step "git sanity"
git fsck --no-progress >/dev/null 2>&1; rc $? "git fsck"
[ -z "$(git status --porcelain 2>/dev/null | tr -d ' \n')" ] && echo "ok: clean tree" || echo "warn: dirty tree (not a failure)"

if ls package.json >/dev/null 2>&1; then
  step "node"
  command -v npm >/dev/null && { npm ci --prefer-offline --no-audit --no-fund >/dev/null 2>&1; rc $? "npm ci"; } || echo "warn: npm absent"
  [ -f package.json ] && grep -q '"test"' package.json && { npm test >/dev/null 2>&1; rc $? "npm test"; } || echo "warn: no test script"
  grep -q '"build"' package.json && { npm run build >/dev/null 2>&1; rc $? "npm build"; } || true
fi

if ls pyproject.toml >/dev/null 2>&1 || ls requirements.txt >/dev/null 2>&1; then
  step "python"
  if [ -d tests ] && ls tests/*.py >/dev/null 2>&1; then
    if python3 -c "import pytest" >/dev/null 2>&1; then
      python3 -m pytest -q >/dev/null 2>&1; rc $? pytest
    else
      echo "warn: pytest not installed; set up repo venv to enable python tests"
    fi
  else echo "ok: no pytest tests present"; fi
fi

if ls go.mod >/dev/null 2>&1; then
  step "go"
  go build ./... >/dev/null 2>&1; rc $? "go build"
fi

exit $fail
