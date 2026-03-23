# OSS Release Testing

## Validation Surface

This mission validates the repository state itself, not an application. All verification is done via CLI commands.

## Verification Commands

| Command | Validates | Expected Result |
|---------|-----------|-----------------|
| `npm run secret-scan` | No hardcoded secrets | Exit 0 |
| `npm run typecheck` | TypeScript compiles | Exit 0 |
| `npm test` | All tests pass | 264 tests pass |
| `npm run release-check` | Full release readiness | Exit 0 |
| `git log --oneline origin/main` | Remote history | Clean limited commits |

## Resource Classification

No concurrent validation needed - this is a single-repo validation task.

## Flow Validator Guidance: repository-state

**Testing surface:** Remote repository history validation via CLI commands

**Isolation rules:**
- Read-only operations against the remote repository
- No cloning to working directory (use /tmp for fresh clones if needed)
- Do not modify any local git state
- Do not push, commit, or alter remote

**Testing tools:**
- `git log --oneline origin/main` - Verify remote commit history
- `npm run secret-scan` - Scan for secrets in current tree
- `git clone` to /tmp for fresh clone verification (clean isolation)

**Key assertions:**
- VAL-REPO-003: No PII or secrets in remote history
  - Verify remote shows only clean limited commits
  - Run secret-scan against remote history
  - Check for credential patterns in git log

**Resource cost:** Low (read-only git operations, no concurrent validators needed)

**Shared state considerations:** None - read-only remote operations are isolated

## Notes

- All verification is command-line based
- No browser or UI testing required
- Fresh clone test is performed to /tmp for isolation
