---
name: fft-skill-creator
description: >
  Create, evaluate, and iterate on new skills for FFT Nano. Use when the user asks
  to create a skill, build a skill, design a skill, write a skill, make a new skill,
  add a skill, draft a skill, author a skill, create capabilities, or add new
  functionality as a skill. Also use when the user wants to improve an existing
  skill, fix a skill, or evaluate whether a skill works correctly. This skill
  teaches the agent the complete workflow from intent capture through testing to
  installation.
license: MIT
compatibility: pi >=0.50
allowed-tools: read, write, edit, bash, grep, find, ls
---

# Skill Creator for FFT Nano

You are an expert at creating high-quality skills for the FFT Nano agent platform.
A skill is a markdown file (`SKILL.md`) placed in `skills/runtime/<skill-name>/` that
teaches the agent how to perform a specific task. Skills are the primary mechanism for
extending FFT Nano's capabilities without code changes.

## When to use this skill

This skill activates when the user asks to create, build, design, write, author,
draft, improve, fix, or evaluate a skill. Follow the workflow below.

## When not to use this skill

- Do not use for general coding tasks that don't involve creating a skill.
- Do not use for modifying existing skills unless the user explicitly asks to improve or fix one.
- Do not use for tasks that should be handled by existing skills (e.g., farm operations should use fft-farm-ops).

## The Skill Creation Workflow

### Step 1: Intent Capture

Before writing anything, understand what the user wants:

1. **Purpose**: What should the skill do? What problem does it solve?
2. **Trigger**: When should the agent activate this skill? What user messages indicate it's relevant?
3. **Scope**: Is this a standalone skill, or does it depend on other skills?
4. **Output**: What should the agent produce when the skill is active?
5. **Tools needed**: Which tools does the skill require? (read, write, bash, grep, find, ls, edit)

Ask clarifying questions if any of these are unclear. Do NOT skip this step.

### Step 2: Research and Design

Based on the intent, determine:

1. **Skill name**: Lowercase, kebab-case, prefixed with `fft-` for FFT Nano skills.
   Example: `fft-irrigation-brain`, `fft-crop-doctor`, `fft-compliance-tracker`
2. **Description**: Write a trigger-rich description. This is the MOST IMPORTANT part
   of the skill. The agent decides whether to use a skill based on its description.
   Include:
   - Primary use cases
   - Adjacent/related use cases the user might phrase differently
   - Explicit trigger phrases ("Use when the user asks about X, Y, or Z")
   - Domain-specific keywords
3. **Dependencies**: Does this skill require data from other skills or services?
   - If it uses farm actions, it depends on `fft-farm-ops`
   - If it needs crop data, it depends on `fft-crop-intelligence`
4. **Reference data**: What formulas, tables, or reference material does the skill need?
   Put these in subdirectories under the skill folder, not in SKILL.md itself.

### Step 3: Write the SKILL.md

Create the file at `skills/runtime/<skill-name>/SKILL.md` with this structure:

```markdown
---
name: <skill-name>
description: >
  <trigger-rich description, 2-4 sentences>
license: MIT
compatibility: pi >=0.50
allowed-tools: <tool1>, <tool2>
---

# <Skill Title>

<Brief explanation of what this skill does and when it activates>

## When to use this skill

<Clear conditions for when the agent should use this skill>

## When not to use this skill

<Conditions when this skill should NOT be used>

## Instructions

<Step-by-step instructions the agent follows when this skill is active>

## Reference Data

<Tables, formulas, lookup data the agent uses>
<Keep this section concise; move detailed data to subdirectories>
```

### SKILL.md Quality Rules

1. **Keep it under 500 lines**. If the skill needs extensive reference material, create
   files in subdirectories (e.g., `skills/runtime/fft-crop-intelligence/crop-tables.md`)
   and instruct the agent to read them with the `read` tool when needed.
2. **Instructions must be actionable**. The agent follows these instructions literally.
   Write "Read the file at X and extract Y" not "Consider the data in X."
3. **Description optimization**: The description is what determines whether the agent
   ever triggers this skill. Spend time getting it right. Include synonyms, related
   concepts, and explicit trigger phrases.

### Frontmatter Fields

| Field | Required | Format | Description |
|---|---|---|---|
| `name` | Yes | string | Lowercase, kebab-case, 1-64 chars, must match folder name |
| `description` | Yes | string | 1-1024 chars, trigger-rich, describes purpose and when to activate |
| `license` | Optional | string | License identifier (MIT recommended) |
| `compatibility` | Optional | string | 1-500 chars, e.g. "pi >=0.50" |
| `allowed-tools` | Optional | string | Comma-separated tool names |
| `metadata` | Optional | map | Key-value pairs for additional metadata |

### Step 4: Write Test Prompts

After writing the SKILL.md, create 2-3 test prompts that exercise the skill's core
behavior. Write these as comments or in a separate evaluation file. Each test prompt
should:

1. Be a realistic user message that should trigger the skill
2. Exercise a different aspect of the skill's functionality
3. Have an expected outcome that can be verified

Example test prompts for an irrigation skill:
- "Soil moisture in zone 3 is 35% and the forecast is dry for the next 5 days. Should I irrigate?"
- "Calculate the ETc for my tomatoes using today's weather data."
- "My lettuce beds feel soggy. The irrigation ran last night. What's happening?"

### Step 5: Validate

Run the FFT Nano skill validation:

```bash
npm run validate:skills
```

This checks:
- Required frontmatter fields (`name`, `description`) are present
- Name is valid (lowercase, kebab-case, no spaces, 1-64 chars)
- Name matches the folder name
- Description is non-empty (1-1024 chars)
- Allowed-tools contains only valid tool names
- No duplicate skill names
- Required sections present: "When to use this skill", "When not to use this skill"

Fix any validation errors before proceeding.

### Step 6: Evaluate (Optional but Recommended)

If the `eval` subagent type is available, test the skill in isolation:

```
/subagents spawn eval <skill-name>
```

This spawns a read-only subagent that:
1. Reads the skill's SKILL.md
2. Follows its instructions against the test prompts
3. Reports whether the skill's instructions produce correct behavior

If the eval subagent is not available, manually review by:
1. Reading the SKILL.md as if you were the agent
2. For each test prompt, follow the instructions literally
3. Check if the output matches the expected outcome

### Step 7: Iterate

Based on evaluation results:
1. Fix any issues found in the skill instructions
2. Optimize the description if the skill didn't trigger when expected
3. Add missing edge cases or guardrails
4. Re-validate and re-evaluate
5. Repeat until the skill performs correctly on all test prompts

## Skill Categories for FFT Nano

When creating skills for FFT Nano, consider which category they fall into:

### Farm Operations
Skills that interact with the farm action gateway and Home Assistant.
These MUST reference `fft-farm-ops` for action patterns and available actions.
Examples: irrigation scheduling, climate control, lighting control.

### Agricultural Intelligence
Skills that provide domain knowledge and decision support.
These teach the agent about crops, soil, weather, pests, diseases.
Examples: crop intelligence, soil analysis, crop doctor, livestock monitoring.

### Data and Integration
Skills that fetch, process, or sync external data.
These use bash for API calls and write for data storage.
Examples: weather data, soil survey, market data, compliance tracking.

### Business and Planning
Skills that help with farm business operations.
Examples: market planning, harvest tracking, customer management, GAP compliance.

### System and Infrastructure
Skills that extend FFT Nano's own capabilities.
Examples: this skill-creator, network discovery, device provisioning.

## Common Mistakes to Avoid

1. **Vague descriptions**: "A skill for farming" tells the agent nothing about when to use it.
   Better: "Irrigation scheduling using soil moisture data, weather forecasts, and
   crop-specific water needs. Use when the user asks about watering, irrigation timing,
   soil moisture thresholds, crop water stress, or ET calculations."

2. **Instructions that assume context**: The agent may activate this skill without any
   prior conversation context. The instructions must be self-contained.

3. **Too much reference data in SKILL.md**: If the skill needs a 200-row crop table,
   put it in a separate file and instruct the agent to `read` it when needed.

4. **Missing guardrails**: Every skill that can modify files, run commands, or control
   devices MUST have guardrails explaining what NOT to do.

5. **Forgetting the farm action gateway**: Skills that need to control HA devices must
   use the action gateway patterns documented in `fft-farm-ops`, not raw HA API calls.

## Existing Skills Reference

Before creating a new skill, check what already exists:

```bash
ls skills/runtime/
```

Current FFT Nano skills:
- `fft-farm-ops`: Farm action gateway patterns and HA control actions
- `fft-skill-creator`: This skill (meta-skill for creating other skills)

Check each existing skill's SKILL.md to avoid duplication and to understand
dependency patterns.
