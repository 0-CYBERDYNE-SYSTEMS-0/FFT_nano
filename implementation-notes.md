# Implementation Notes

## 2026-05-21 - Skill Manager Schema and Source Metadata

- Decision: keep `allowed-tools` as a string in skill frontmatter. Claude Code documents it as a string such as `Read, Grep, Glob`, and this repo's existing skills already use string values like `bash` and `read_file ddgs_search`.
- Change: catalog generation should parse `allowed-tools` strings into the existing `SkillCatalogEntry.allowedTools: string[]` shape instead of requiring skill authors to use YAML arrays.
- Decision: preserve backward compatibility for `.fft_nano_managed_skills.json` by keeping the existing `managed` array and adding a per-skill source map. Older manifests without source metadata continue to classify managed skills as `project`.
- Tradeoff: source metadata is tracked at sync time. A previously-synced external skill will show as `project` until the next sync rewrites the manifest with the new source map.

## 2026-05-21 - Forced Delegation Direct Delivery

- Decision: kept the fix to the direct leak path only. Removed `pi-runner`'s forced-delegation `chat_delivery_requested` publish instead of adding a validator JSON detector or changing evaluator policy.
- Tradeoff: long forced-delegation output is no longer saved by `pi-runner` to `groups/<group>/coder_runs`. That path bypassed the orchestrator and was the source of raw client delivery; any artifact/report behavior should live in the caller/orchestrator.

## 2026-05-21 - Background Chat Validation

- Decision: removed the non-blocking chat/heartbeat evaluator pass from `runAgent`. Validation now either participates in the blocking retry/suppression path or does not run for that response.
- Tradeoff: cheap/background quality telemetry is reduced, but behavior is simpler and avoids validator failures that cannot trigger repair.
## 2026-05-19 — Telegram Group Approval

- Decision: keep `TELEGRAM_AUTO_REGISTER` for known main/private bootstrap cases, but stop it from registering non-main Telegram groups. Unknown Telegram groups now always go through explicit approval so owners stay in control.
- Decision: use Telegram inline keyboards and callback queries through the existing settings-panel token registry. Telegram's current bot docs recommend inline keyboards for behind-the-scenes actions and editing the message after state changes, which matches the existing panel system.
- Decision: persist approval state in `data/telegram_group_approvals.json` rather than `groups/` or git-tracked files. This is runtime/operator state, not release content.
- Decision: unknown group messages are still not stored as chat history before approval. The host only stores chat metadata, creates a pending approval record, replies in the group with a clear waiting message, and notifies the main Telegram chat.
- Tradeoff: pending notifications to the main chat are throttled per group for 10 minutes to avoid panel spam. The group still gets a direct response when it addresses the bot so users do not experience silence.
- Tradeoff: the `/groups` command is now main/admin-only because the panel exposes group registration controls and chat identifiers.
- Change: the legacy Admin Panel `Groups` button now opens the same group-management panel instead of sending static text.
- Change: approval creates the same folder shape as Telegram auto-registration (`telegram-<chat id>`) and sends a confirmation into the approved group.
- Change: added `groups/testrun_aborted_*/` to `.gitignore` because the local test/runtime harness can create those folders and they should not become release artifacts.

## 2026-05-19 — Coder Harness

- Scope decision: implement the Anthropic-style harness inside the existing coder orchestrator instead of adding a separate runner. The repo already has `/coder-plan`, `/coder`, isolated worktrees, and a blocking evaluator loop, so the lowest-risk path is to wrap those with durable contract and QA artifacts.
- Artifact location decision: store host-owned coder artifacts under `groups/<group>/coder-runs/<requestId>/` rather than inside the target project. Plan mode is explicitly read-only against project files, so writing plan artifacts into the project workspace would violate the spirit of plan mode.
- Contract decision: use the plan output itself as the durable spec/contract for `/coder-plan`, wrapped with host metadata. For `/coder`, generate an execution contract from the user task plus any available latest plan context for the same group/workspace when it is safe to include.
- Staleness tradeoff: latest plan context can help `/coder` continue after `/coder-plan`, but silently binding an unrelated old plan would be dangerous. I am treating previous plan text as advisory context only; the execution contract remains anchored to the current `/coder` task text.
- Workspace matching decision: previous plan context is included only when the effective workspace root matches the current execute request. This avoids carrying a plan from one project into another project just because it came from the same chat.
- Evaluator loop change: execute mode now evaluates the initial result and each refined result up to the refinement cap, rather than allowing the final refinement to go unchecked. This makes the QA verdict in the final message match the latest evaluated output.
- Release hygiene decision: `groups/**/coder-runs/` is ignored because these artifacts are runtime records like logs and group state, not release assets. The final message gives absolute paths so the operator can inspect them locally.
