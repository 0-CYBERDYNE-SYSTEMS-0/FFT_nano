# FFT Nano Skill-Creator Implementation Plan

## Objective

Implement a `skill-creator` meta-skill for FFT Nano, modeled after Anthropic's `skill-creator` from `anthropics/skills` and conforming to the Agent Skills specification at `agentskills.io/specification`. This skill enables the agent to create, iterate on, and improve other skills -- including the agricultural intelligence skills planned for the FFT Nano platform.

## Context

### What We're Building On

FFT Nano's skill system is **spec-compliant** at the frontmatter level (all 6 fields match the Agent Skills spec exactly: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`). It adds FFT-specific extensions (required skills, guardrails, high-risk name detection, section policies).

### What Doesn't Exist Yet

There is **no meta-skill for creating other skills**. Currently, building a new skill requires:
1. Manually creating a directory under `skills/runtime/`
2. Writing a `SKILL.md` with correct frontmatter
3. Running `npm run validate:skills` to check compliance
4. Testing by restarting the agent and trying prompts

The skill-creator automates this entire loop: intent capture, drafting, test case creation, evaluation, iteration, and description optimization.

### Key Differences from Anthropic's Implementation

Anthropic's `skill-creator` is designed for Claude Code/Claude.ai environments with subagents, browser-based eval viewers, and `claude -p` CLI access. FFT Nano's agent runs in a `pi` container with different tool access. The FFT Nano version must be adapted to:

| Anthropic Feature | FFT Nano Adaptation |
|---|---|
| Subagents for parallel eval runs | Single agent sequential eval (no subagents in pi container) |
| Browser-based eval viewer | Text-based eval results in Telegram/chat |
| `claude -p` for description optimization | Manual description review by user |
| `package_skill.py` for .skill files | Not applicable (skills live in `skills/runtime/`) |
| `eval-viewer/generate_review.py` | Results reported inline in chat |
| Baseline runs (with/without skill) | Before/after comparison across iterations |

### The Progressive Disclosure Problem

The current system injects all skill catalog summaries into every prompt with a 6000-char budget. At 9 runtime skills, this is manageable. Adding 19 agricultural skills (from the agtech plan) would overflow it. The skill-creator should document the recommended approach: keep the SKILL.md body under 500 lines, use `references/` for detailed content, and let the agent read full skill files on demand.

---

## Implementation Plan

### Phase 1: Create the skill-creator skill directory and SKILL.md

- [ ] Create directory `skills/runtime/fft-skill-creator/`
- [ ] Write `skills/runtime/fft-skill-creator/SKILL.md` with:
  - Frontmatter: `name: fft-skill-creator`, description covering create/modify/improve/eval skills
  - Body sections adapted from Anthropic's skill-creator but rewritten for FFT Nano's architecture:
    - Intent capture (what the skill should do, when it triggers, expected output)
    - Interview and research (edge cases, dependencies, success criteria)
    - SKILL.md writing guide (anatomy, progressive disclosure, writing patterns, FFT-specific frontmatter requirements including guardrails for high-risk skills, "When to use" / "When not to use" sections)
    - Test case creation (2-3 realistic prompts per skill)
    - Evaluation loop (run test prompts, capture results, user reviews, iterate)
    - Description optimization (trigger accuracy, "pushy" descriptions per Anthropic's guidance)
    - FFT Nano specifics: `npm run validate:skills`, skill sync to pi home, catalog budget awareness
- [ ] Add `references/` subdirectory with:
  - `references/fft-skill-guide.md` -- FFT Nano-specific skill authoring guide (frontmatter fields, validation rules, guardrail requirements for high-risk skills, section policies, catalog budget math, examples from existing skills)
  - `references/skill-templates.md` -- Templates for common FFT Nano skill patterns (ops skill template, reference-heavy skill template, script-bundled skill template)
- [ ] Run `npm run validate:skills` to verify the skill passes validation

### Phase 2: Adapt the evaluation workflow for FFT Nano

- [ ] Design a simplified eval workflow that works within pi container constraints:
  - No subagents: the agent runs test prompts sequentially, reading the skill's SKILL.md and following its instructions
  - No browser viewer: results are presented inline in the chat with structured output
  - Baseline comparison: the agent attempts the same task without the skill and compares outputs
  - Iteration tracking: results organized by iteration in a workspace directory
- [ ] Document the eval workflow in the skill-creator's SKILL.md body:
  - Step 1: Write test prompts and share with user for approval
  - Step 2: Agent reads the skill, follows its instructions, produces output
  - Step 3: Present output to user with structured evaluation questions
  - Step 4: User provides feedback (what worked, what didn't, what to change)
  - Step 5: Agent revises the skill based on feedback
  - Step 6: Repeat until user is satisfied
  - Step 7: Run `npm run validate:skills` as final check
- [ ] Add guidance on when test cases are valuable (objectively verifiable outputs) vs. when they're not (subjective outputs like writing style)

### Phase 3: Add description optimization guidance

- [ ] Port Anthropic's description optimization principles:
  - The description is the primary triggering mechanism
  - Include both what the skill does AND specific contexts for when to use it
  - Make descriptions "pushy" -- Claude tends to under-trigger skills
  - Include keywords from the domain the user operates in
  - Cover adjacent use cases, not just the obvious ones
- [ ] Adapt for FFT Nano's catalog system:
  - The `whenToUse` section in the SKILL.md body feeds into the catalog entry
  - The catalog entry is what the agent sees at inference time
  - Good descriptions reduce false negatives (skill not triggered when it should be)
- [ ] Add a description review checklist to the skill-creator

### Phase 4: Integrate with existing skill infrastructure

- [ ] Ensure `buildSkillCatalogEntries()` in `src/pi-skills.ts` correctly handles the new skill (it should work automatically since it reads all skills from `skills/runtime/`)
- [ ] Verify the catalog budget: current 9 skills + 1 skill-creator = 10 skills. At ~250 chars each = ~2500 chars, well within the 6000-char budget
- [ ] Test that the skill-creator appears in the catalog and the agent can read its full SKILL.md on demand
- [ ] Add the skill-creator to the "When to use" guidance in existing skills if appropriate (e.g., `fft-setup` could mention "use fft-skill-creator to create new skills")

### Phase 5: Testing and validation

- [ ] Run `npm run validate:skills` -- skill-creator must pass all validation
- [ ] Run `npm test` -- all existing tests must still pass
- [ ] Manual smoke test: ask the agent to create a simple skill using the skill-creator, verify it follows the documented workflow
- [ ] Verify catalog budget with `npm run dev` and checking the rendered catalog
- [ ] Test the eval loop end-to-end: create a trivial skill, run test cases, get feedback, iterate

### Phase 6: Documentation updates

- [ ] Update `CLAUDE.md` or `AGENTS.md` to mention the skill-creator capability
- [ ] Add a brief note to `CONTRIBUTING.md` about skill creation workflow using the skill-creator

---

## Verification Criteria

- `npm run validate:skills` passes with the new skill included
- `npm test` passes (all existing tests unaffected)
- The skill-creator appears in the agent's skill catalog with a clear description
- The agent can read the full SKILL.md and follow its instructions to create a new skill
- The created skill passes `npm run validate:skills`
- The catalog budget remains within limits (< 6000 chars)
- The eval workflow produces structured, reviewable output in the chat

## Potential Risks and Mitigations

1. **Catalog budget overflow**: Adding the skill-creator brings the total to 10 skills. Mitigation: monitor budget usage; if agricultural skills are added later, the budget may need to increase or skills need to be loaded dynamically.

2. **Eval workflow mismatch**: Anthropic's eval system relies on subagents and browser viewers that don't exist in pi containers. Mitigation: the simplified text-based eval workflow is less rigorous but functional; the human review step compensates for the lack of automated grading.

3. **Skill quality without automated grading**: Without the `eval-viewer` and grading scripts, skill quality depends entirely on human review. Mitigation: the skill-creator emphasizes structured feedback collection and iteration; the validate:scripts catch structural issues.

4. **Over-triggering**: Making descriptions "pushy" could cause the skill-creator to trigger when the user just wants to chat about skills conceptually. Mitigation: the "When not to use" section should clearly delineate between "create a skill" (use skill-creator) and "tell me about skills" (don't use skill-creator).

## Alternative Approaches

1. **Build a standalone CLI tool** (`fft create-skill`) instead of an agent skill: This would give more control over validation and scaffolding but loses the agent's ability to reason about the skill's content, write nuanced instructions, and iterate based on natural language feedback. The skill-based approach is better because skill authoring is fundamentally a reasoning task.

2. **Port the full Anthropic eval infrastructure** (Python scripts, HTML viewer, grading system): This would provide rigorous evaluation but requires significant engineering effort and doesn't work in the pi container environment. The simplified approach is more pragmatic for FFT Nano's current architecture.

3. **Skip the skill-creator and hand-author all agricultural skills**: This is faster for the first batch but doesn't scale. The skill-creator is a force multiplier -- once it works well, creating new agricultural skills becomes much faster and more consistent.
