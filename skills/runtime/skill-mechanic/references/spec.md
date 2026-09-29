# Agent Skills spec — offline snapshot (agentskills.io, captured 2026-07)

Used so audits don't depend on network access. If a rule here seems to
conflict with observed agent behavior, verify against agentskills.io.

## Structure

A skill = a directory containing `SKILL.md` (required), plus optional
`scripts/` (executable code), `references/` (on-demand docs), `assets/`
(templates/data). Any additional files are allowed.

## SKILL.md frontmatter

| Field | Required | Rules |
|---|---|---|
| `name` | yes | 1-64 chars; lowercase a-z, 0-9, hyphens; no leading/trailing/consecutive hyphens; must match parent directory name |
| `description` | yes | 1-1024 chars; should say what the skill does AND when to use it, with routing keywords |
| `license` | no | short: license name or bundled-file pointer |
| `compatibility` | no | 1-500 chars; only if the skill has environment requirements |
| `metadata` | no | arbitrary string→string map (commonly author, version, source) |
| `allowed-tools` | no | space-separated pre-approved tools (experimental; support varies) |

## Progressive disclosure (the core contract)

1. Metadata (~100 tokens/skill): name+description of every installed skill is
   always in context.
2. Instructions (<5k tokens recommended, <500 lines): full SKILL.md body loads
   on activation.
3. Resources: bundled files load only when the body points at them.

File references: relative paths from the skill root, kept one level deep.

## Claude Code extensions (ignored by other agents)

`disable-model-invocation` (manual-only via /name), `user-invocable: false`
(hidden from / menu), `allowed-tools`/`disallowed-tools` per-turn grants,
`model`, `effort`, `context: fork` + `agent` (subagent execution), `hooks`,
`paths` (glob-scoped activation), `shell`, dynamic context injection
(`` !`cmd` `` runs before the model reads the file), `$ARGUMENTS`/`$0..$n`
substitution. Skills live at user (`~/.claude/skills/`), project
(`.claude/skills/`), and plugin tiers.

## Known agent library locations on this machine

| Agent | Root | Notes |
|---|---|---|
| Claude Code | `~/.claude/skills/` | plus per-project `.claude/skills/` |
| OpenClaw | `~/.openclaw/skills/` | plus `~/.openclaw/plugin-skills/` (plugin-managed) |
| fft_nano | `~/fft_nano/skills/runtime/` | registered in `~/fft_nano/skills/manifest.json` (`bundled` list) |
| hermes-agent | `~/hermes-agent/skills/` | git repo; skills sometimes grouped in category subdirs |

## Reference validator

`skills-ref validate ./my-skill` (github.com/agentskills/agentskills) is the
upstream validator; `skilltool.py validate` mirrors its frontmatter rules and
adds library-level checks it doesn't have.
