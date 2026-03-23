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

## Notes

- All verification is command-line based
- No browser or UI testing required
- Fresh clone test is performed to /tmp for isolation
