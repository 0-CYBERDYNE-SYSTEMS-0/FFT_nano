# Skill System Cleanup + Install Anthropic Skill-Creator

## Objective

Three changes to the skill system:
1. Remove the skills catalog character budget (6000 char limit)
2. Delete non-functional `add-gmail` and `x-integration` setup skills
3. Install the exact Anthropic `skill-creator` from GitHub (no `fft-` prefix)

Existing `fft-` prefixed skills keep their prefix. New/installed skills do not get the prefix.

## Implementation Plan

- [ ] Remove skills catalog budget limit
  - File: `src/parity-config.ts` -- change `skillCatalogMaxChars` default from `6_000` to `200_000` (effectively unlimited)
  - Rationale: The 6000 char budget artificially limits how many skills can be loaded. With agricultural skills coming (19+ planned), the budget would be exhausted immediately. No technical reason for the limit -- it was a conservative default.

- [ ] Delete non-functional `add-gmail` setup skill
  - Remove directory: `skills/setup/add-gmail/`
  - Rationale: References `container/agent-runner/` and MCP IPC system that doesn't exist in the current `pi`-based architecture. Completely non-functional.

- [ ] Delete non-functional `x-integration` setup skill
  - Remove directory: `skills/setup/x-integration/`
  - Rationale: References `container/agent-runner/`, `processTaskIpc()`, and custom MCP tools that don't exist. Completely non-functional.

- [ ] Remove the adapted `fft-skill-creator` skill
  - Remove directory: `skills/runtime/fft-skill-creator/`
  - Rationale: Being replaced by the exact Anthropic version.

- [ ] Install the exact Anthropic `skill-creator` from GitHub
  - Source: `https://github.com/anthropics/skills/tree/main/skills/skill-creator`
  - Target: `skills/runtime/skill-creator/`
  - Files to install:
    - `SKILL.md` -- the main skill body (exact copy from Anthropic, ~33K chars)
    - `references/grader.md` -- evaluation rubric reference
    - `references/schemas.md` -- frontmatter schema reference
    - `LICENSE.txt` -- MIT license
  - Do NOT install: `scripts/`, `eval-viewer/`, `agents/` (Claude Code-specific tooling)
  - Rationale: User wants the exact Anthropic skill-creator, not an adapted version.

- [ ] Update FFT Nano skill validator to accept Anthropic's frontmatter fields
  - File: `src/pi-skills.ts` -- add `guardrails` and `required_skills` to `FRONTMATTER_OPTIONAL_FIELDS`
  - The Anthropic SKILL.md uses `guardrails` and `required_skills` frontmatter fields that FFT Nano's validator currently rejects as unsupported.
  - Rationale: Installing the exact Anthropic skill-creator requires the validator to accept its frontmatter. These fields are harmless when present on other skills (they're just ignored by the current system).

- [ ] Verify all skills pass validation
  - Run: `npm run validate:skills`
  - Ensure the new `skill-creator` passes with its full frontmatter
  - Ensure all 13 remaining skills still pass

- [ ] Verify catalog budget is no longer constraining
  - Check that `buildSkillCatalogEntries()` no longer truncates entries
  - Confirm the full catalog (14 skills) renders completely

- [ ] Run full test suite
  - `npx tsc --noEmit` -- typecheck clean
  - `npm test` -- all 326 tests pass
  - `npm run build` -- build clean

- [ ] Commit changes
  - Single commit covering all changes
  - Message: "chore: remove skill catalog budget, delete non-functional skills, install Anthropic skill-creator"

## Verification Criteria

- `npm run validate:skills` passes with 0 errors for all 14 skills (13 existing + 1 new skill-creator)
- `skills/runtime/skill-creator/SKILL.md` is the exact content from Anthropic's GitHub (not adapted)
- `skills/setup/add-gmail/` and `skills/setup/x-integration/` directories no longer exist
- `skills/runtime/fft-skill-creator/` directory no longer exists
- The skill catalog renders all 14 entries without truncation
- All 326 tests pass, typecheck clean, build clean

## Potential Risks and Mitigations

1. **Anthropic SKILL.md references Claude Code-specific features** (subagents, eval viewer, browser-based eval)
   Mitigation: These are instructions for the agent, not runtime dependencies. The agent will understand it's running in FFT Nano and adapt. The eval subagent type we built can serve a similar purpose to Claude Code's eval.

2. **Anthropic SKILL.md uses frontmatter fields not previously supported**
   Mitigation: Adding `guardrails` and `required_skills` to the optional fields list. These are silently ignored by the current system -- they don't break anything.

3. **The SKILL.md is ~33K chars** -- much larger than existing skills (~2-5K chars)
   Mitigation: With the budget removed, this is fine. The skill is loaded into the agent's context only when triggered (via the catalog description), not injected into every prompt. The catalog entry itself is just the name + description + when-to-use (~300 chars).

4. **Removing setup skills that might be referenced in docs or onboarding**
   Mitigation: Neither `add-gmail` nor `x-integration` is referenced in `CLAUDE.md`, `AGENTS.md`, or any code files. They are standalone skill directories with no external references.

## Alternative Approaches

1. **Adapt the Anthropic SKILL.md instead of installing exact**: Would lose the benefit of using the canonical version. The user explicitly wants the exact version.
2. **Keep the budget but raise it to 50K**: Still an artificial limit. Better to remove it entirely and let the system prompt context window be the natural constraint.
3. **Keep non-functional skills for future reference**: They reference an architecture that no longer exists. If Gmail/X integration is needed later, new skills would need to be written for the current `pi`-based architecture anyway.
