# Governance Verification Checklist

When verifying OSS governance artifacts, check the following:

## Issue Templates (.github/ISSUE_TEMPLATE/)

- **bug_report.yml** should include structured fields:
  - Platform/environment information
  - Reproduction steps
  - Expected vs actual behavior
  - Logs/screenshots attachment

- **feature_request.yml** should include:
  - Problem statement
  - Proposed solution
  - Alternative approaches considered
  - Additional context

## Pull Request Template (.github/PULL_REQUEST_TEMPLATE.md)

- **Type classification**: Checkboxes for skill/fix/simplification/release
- **Skills section**: Which worker skill to invoke
- **Release hygiene**: Checkboxes for tests passing, documentation updated, changelog updated

## GitHub Actions Workflows (.github/workflows/)

- **No hardcoded secrets**: All workflows must use:
  - GitHub context variables (`{{ github.* }}`)
  - Environment variables (`env.*`)
  - Secrets through GitHub Secrets API (`{{ secrets.* }}`)

- **OSS-appropriate jobs**:
  - secret-scan: Validates no credentials in code
  - quick-checks: Lint and format validation
  - full-checks: Complete test suite

## Git Hooks (hooks/)

- **Tracked in git**: All hook scripts must be committed
- **Executable**: Bash scripts with proper shebang (`#!/usr/bin/env bash`)
- **Error handling**: Use `set -euo pipefail` for safety
- **Standard hooks**:
  - pre-commit: Run lint/format checks
  - pre-push: Run full test suite
  - pre-merge-commit: Validation checks before merge

## Verification Commands

```bash
# Verify issue templates exist
ls -la .github/ISSUE_TEMPLATE/

# Verify PR template exists
cat .github/PULL_REQUEST_TEMPLATE.md

# Verify no hardcoded secrets in workflows
grep -r "api_key\|password\|secret" .github/workflows/

# Verify git hooks are tracked
git ls-files hooks/

# Run validation suite
npm test
npm run typecheck
npm run secret-scan
```

## Known False Positives

When running `npm run secret-scan` during validation tasks:
- **Ignore**: Personal paths in `.factory/validation/` directory
- **Reason**: Validation reports contain metadata (mission dir, worker session IDs) which is expected infrastructure behavior, not a security concern
- **See also**: AGENTS.md guidance for validation workers
