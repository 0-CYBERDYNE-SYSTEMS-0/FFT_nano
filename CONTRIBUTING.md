# Contributing

## Source Code Changes

FFT_nano is a product-focused fork. Contributions should:

- Preserve the security model (container isolation + minimal mounts)
- Stay understandable (prefer direct code over framework layers)
- Include a clear threat-model note for new integrations

**Accepted:** bug fixes, security fixes, farm-assistant features, docs updates.

**Please avoid:** "platform/framework" work that adds abstraction without user value.

## Branch Protection & Merge Requirements

### Required GitHub Branch Protection Settings for `main`

Maintainers must configure these settings in GitHub UI under **Settings → Branches → Branch protection rules → Edit "main"**:

1. **Require a pull request before merging**
   - Require at least 1 approving reviews
   - Dismiss stale reviews when new commits are pushed
   - Require review from Code Owners

2. **Require status checks to pass before merging**
   - Add required status checks:
     - `secret-scan` (GitHub Actions)
     - `quick-checks` (GitHub Actions)
     - `full-checks` (GitHub Actions)
   - Require branches to be up to date before merging

3. **Require signed commits**
   - Require signed commits

4. **Include admin enforcement**
   - Do NOT include admin override (admins should also follow the process)

5. **Merge queue**
   - Configure merge queue to prevent merge conflicts
   - Set maximum 2 jobs in the queue at a time

### Local Development Hooks

The repository includes git hooks (`.git/hooks/`) that run before commits and pushes:

- **pre-commit**: Runs `npm run typecheck` and `npm test`
- **pre-push**: Runs `npm run typecheck`, `npm test`, and `npm run secret-scan`
- **pre-merge-commit**: Runs `npm run secret-scan`

These hooks are automatically installed. To bypass them in emergencies, use `--no-verify` (avoid if possible).

### CI/CD Pipeline

All checks must pass before merging to `main`:

1. **secret-scan**: Scans for hardcoded secrets using gitleaks and custom patterns
2. **quick-checks**: TypeScript typecheck, secret scan, and skill validation
3. **full-checks**: Full release check including tests

### Preventing Future Merge Issues

To avoid the v1.2.0 merge issue (duplicate functions, orphaned code):

- Always run `npm run release-check` locally before pushing
- Review PRs for merge conflicts carefully
- If using merge commits, ensure the base branch is fully merged
- Use `git log --oneline --graph` to visualize merge structure
