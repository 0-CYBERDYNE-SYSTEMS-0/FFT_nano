# PR Management Specification

Status: Operational

Target branch: main

Repository: FFT_nano

## 1. Purpose

This specification defines how to prepare, review, order, merge, and close pull requests.

It keeps main release-ready and prevents unrelated changes from entering one PR.

## 2. Core rules

- Keep the runtime checkout on main.
- Do feature work in the development checkout or a feature worktree.
- Never push directly to origin/main.
- Keep one user goal in each PR.
- Keep each PR small enough for one focused review.
- Preserve local work that is outside the current PR.
- Do not merge a PR with unresolved conflicts.
- Do not call a PR ready until its branch is current with main.
- The operator merges PRs after review.

## 3. PR states

Use these states for every PR:

- candidate: local work exists, but no PR is ready.
- submitted: PR exists on GitHub.
- green: all required checks pass on the current PR head.
- mergeable: GitHub reports no conflicts with main.
- ready: the PR is green, mergeable, reviewed, attributed, and scoped.
- blocked: the PR needs a decision, code change, or external action.
- closed: the PR is obsolete, duplicated, or replaced.

Green status does not mean mergeable status.

Mergeable status does not mean the change matches the intended design.

## 4. Required PR metadata

Every PR must include:

- A focused title using type(scope): summary.
- A short problem statement.
- A clear change list.
- A test list with exact commands.
- Known limitations or pre-existing failures.
- Dependencies on other PRs.
- Files or systems with deliberate behavior changes.
- A security or threat-model note for new integrations.

Every commit must use this identity unless the operator approves another identity:

~~~text
0-CYBERDYNE-SYSTEMS-0 <134018026+0-CYBERDYNE-SYSTEMS-0@users.noreply.github.com>
~~~

Before a PR is ready, verify:

~~~bash
git config user.name
git config user.email
git log --format='%h %an <%ae> %s' -5
~~~

## 5. Branch and worktree procedure

Start every task with a read-only scope check:

~~~bash
git status --short --branch
git worktree list
git branch --show-current
git log --oneline --decorate -10
~~~

Use a feature branch from the current target branch:

~~~bash
git fetch origin --prune
git switch -c feat/<short-name> origin/main
~~~

Do not stage the entire worktree.

Stage only files that belong to the current PR.

Do not include personal paths, local data, secrets, reports, or test artifacts.

## 6. Pre-submission checks

Before pushing, run:

~~~bash
git diff --check
npm run typecheck
npm test
npm run secret-scan
npm run validate:skills
npm run release-check
~~~

Use focused tests during development.

Run the complete release checks before submission.

Record the exact commit tested.

The PR head must equal the tested commit.

## 7. Review procedure

Review every PR on two axes.

### Standards review

Check the repository instructions, coding style, security model, and release process.

Check for:

- Unrelated files or behavior.
- New abstractions without clear user value.
- Changes to frozen kernel surfaces.
- Missing tests for changed behavior.
- Missing threat-model notes for new integrations.
- Missing attribution.
- Stale branches or manual-only test evidence.

### Specification review

Check that the code implements the stated goal.

Check that:

- The problem is real and reproduced when possible.
- The change fixes the root cause.
- The behavior matches the project specification.
- The tests cover the changed behavior.
- The PR does not contradict current main behavior.
- Documentation matches the new default or contract.

## 8. Dependency and overlap rules

Build a file-overlap map before merging a group of PRs.

If two PRs change the same implementation file, choose an order.

After the first PR merges:

1. Update the next branch from origin/main.
2. Resolve only the intended changes.
3. Run the full release checks again.
4. Confirm the PR head is current and mergeable.

Do not merge several stale branches in sequence.

Use this dependency notation in PR bodies:

~~~text
Depends on: #123
Conflicts with: #124
Merge before: #125
~~~

Independent PRs may merge in any order when their file and behavior maps do not overlap.

## 9. Conflict handling

Close and rebuild a PR when its intended content already exists on main.

Close and rebuild a PR when the branch contains large stale reversions.

Close and replace a PR when it contains an obsolete architecture or specification.

Never resolve a conflict by accepting a stale branch deletion without review.

Never use a passing local test as proof that a conflicting PR is ready.

Manual test results do not replace required GitHub checks.

## 10. Merge procedure

The operator merges one PR at a time.

For each PR:

1. Confirm the PR targets main.
2. Confirm the PR is not a draft.
3. Confirm the branch is current with main.
4. Confirm GitHub reports no conflicts.
5. Confirm all required checks pass on the current head.
6. Confirm at least one approval exists.
7. Confirm the commit author identity.
8. Merge the PR.
9. Update the local runtime checkout from origin/main.
10. Build and verify the runtime before the next release change.

Do not merge a PR only because it is green.

## 11. Provider and model changes

Review provider work as separate states:

1. Registry entry exists.
2. Configuration accepts the provider.
3. Authentication reaches the runtime.
4. Model discovery or catalog listing works.
5. A real model request succeeds.

Do not call a provider working because its model appears in a catalog.

Keep provider changes focused by provider family.

Do not expose API keys in commits, PR text, logs, or test output.

Use redacted evidence for endpoints, model IDs, and authentication status.

## 12. Runtime and heartbeat changes

When a default changes, update all affected surfaces together:

- Source configuration.
- Shipped configuration files.
- Environment examples.
- README and operator documentation.
- Agent instructions.
- Specifications.
- Tests.

Separate source behavior from live service behavior.

Verify the active service checkout before making runtime claims.

## 13. PR body template

~~~~markdown
## Goal

<!-- State one user-visible goal. -->

## Scope

- Included:
- Not included:

## Changes

-

## Dependencies

- Depends on:
- Conflicts with:
- Merge before:

## Verification

~~~bash
git diff --check
npm run release-check
~~~

## Runtime verification

<!-- State whether live runtime verification occurred. Include the checkout and revision. -->

## Security and secrets

<!-- State the threat model and confirm that no secret values were committed. -->

## Known limitations

-
~~~~

## 14. Final readiness checklist

- [ ] The PR has one focused goal.
- [ ] The target is main.
- [ ] The branch is current with main.
- [ ] The PR has no conflicts.
- [ ] The PR is not a draft.
- [ ] The required GitHub checks pass on the current head.
- [ ] The full release checks pass locally.
- [ ] The change has focused tests.
- [ ] Documentation matches the behavior.
- [ ] No unrelated files are included.
- [ ] No secrets are included.
- [ ] The author identity is correct.
- [ ] Dependencies and overlap are documented.
- [ ] A reviewer approved the PR.
- [ ] The operator has reviewed the merge order.

## 15. Closeout

After the final merge:

~~~bash
git -C ~/fft_nano pull --ff-only origin main
npm run build
./scripts/service.sh restart
./scripts/web.sh
curl -sS http://127.0.0.1:28990/api/runtime/status
~~~

Confirm the runtime reports the expected branch and commit.

Record any failed check, conflict, or deferred PR for the next review cycle.
