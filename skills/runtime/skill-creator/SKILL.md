---
name: skill-creator
description: Create or update Agent Skills in this repo using agentskills.io-compliant folder names and SKILL.md frontmatter so validate:skills stays green.
---

# Skill Creator

## When to use this skill
- The user asks to create a new skill.
- The user asks to migrate or repair a skill that fails `npm run validate:skills`.
- A skill needs cleanup to match the Agent Skills specification.

## When not to use this skill
- The request is only to execute an existing skill.
- The request is unrelated to skill authoring or maintenance.

## Required output standard
1. Skill folder name must be lowercase and hyphenated.
2. `SKILL.md` must begin with YAML frontmatter delimited by `---`.
3. Frontmatter must include:
   - `name`: exactly matches the folder name.
   - `description`: concise and specific.
4. Only use supported frontmatter keys:
   - `name`
   - `description`
   - `license`
   - `compatibility`
   - `metadata` (string key/value map only)
   - `allowed-tools`
5. If legacy fields exist (`slug`, `summary`, `version`, `author`, etc.), migrate them into `metadata` as strings.

## Creation workflow
1. Choose a canonical folder path under `skills/runtime/<skill-name>/`.
2. Write `SKILL.md` with valid frontmatter and core instructions.
3. Add optional `scripts/`, `references/`, or `assets/` only when needed.
4. Run `npm run validate:skills`.
5. If validation fails, fix the skill before returning.

## Update workflow
1. Preserve existing intent and body instructions.
2. Normalize frontmatter to supported keys.
3. Ensure `name` matches folder exactly.
4. Re-run `npm run validate:skills`.

## Minimal template
```md
---
name: example-skill
description: One sentence describing what this skill does and when to use it.
---

# Example Skill

## When to use this skill
- ...

## When not to use this skill
- ...

## Workflow
1. ...
```
