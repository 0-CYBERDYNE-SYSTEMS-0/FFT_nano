---
name: kimi-writing
description: Kimi-K2.5 Writing Skill.
---

# Kimi-K2.5 Writing Skill

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

## Overview

Professional and creative writing assistant powered by Moonshot AI's Kimi-K2.5 model via OpenRouter. Built for thoughtful, domain-aware content that avoids generic AI slop.

## Model Details

- **Model:** `moonshotai/kimi-k2.5`
- **Architecture:** 1T Mixture-of-Experts (32B active parameters)
- **Context Window:** 256K tokens
- **Modes:** Thinking (deep reasoning, t=1.0) and Instant (quick output, t=0.6)
- **Multimodal:** Supports text, images, and video inputs

## Key Features

### 1. Anti-AI Slop Guardrails

Baked-in system prompt that prevents generic content farm output:

- Avoids buzzword salads and corporate speak
- Enforces specific, concrete details
- Requires natural voice and rhythm
- Varies sentence structure
- Trusts reader intelligence

### 2. Domain Awareness

Automatically detects and adapts to:

- Agriculture & farming
- Technology & SaaS
- Business & corporate
- Creative & narrative
- Technical documentation
- Marketing & copywriting

### 3. Writing Modes

- **Thinking Mode:** Complex reasoning, long-form, nuanced topics
- **Instant Mode:** Quick copy, short-form, direct outputs
- **Auto-select:** Chooses based on task complexity

### 4. Agent Swarm Ready

Can parallelize long-form writing:

- Research + write simultaneously
- Multi-section document generation
- Iterative refinement loops

## Installation

```bash
cd /Users/scrimwiggins/clawdbot/skills/kimi-writing
uv pip install openai pydantic python-dotenv
```

## Configuration

Set your OpenRouter API key:

```bash
export OPENROUTER_API_KEY="your-key-here"
```

Or create `.env` file:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

## Usage

### Basic Writing

```bash
uv run scripts/write.py "write a landing page for farm tech SaaS" \
  --mode thinking \
  --style marketing \
  --audience "farmers, agronomists"
```

### With Context

```bash
uv run scripts/write.py "create whitepaper on precision irrigation" \
  --domain agriculture \
  --format pdf \
  --tone authoritative
```

### Refine Existing Text

```bash
uv run scripts/write.py refine draft.md \
  --style professional \
  --make-human \
  --reduce-corporate-speak
```

### Multi-Agent Workflow

```bash
uv run scripts/write.py plan "technical documentation series" \
  --agent-swarm
```

## Writing Types Supported

**Professional:**

- Proposals, reports, emails, memos
- Business correspondence
- Policy documents

**Creative:**

- Stories, narratives, scripts
- Poetry, song lyrics
- Screenplays

**Website Copy:**

- Landing pages, product descriptions
- About pages, mission statements
- Calls-to-action

**Technical:**

- Documentation, tutorials
- API references, guides
- Technical blog posts

**Marketing:**

- Ad copy, social posts
- Email sequences, newsletters
- Campaign materials

**Research:**

- Summaries, abstracts
- Literature reviews
- White papers

## CLI Options

| Option          | Description                                      | Default        |
| --------------- | ------------------------------------------------ | -------------- |
| `--mode`        | `thinking` or `instant`                          | `auto`         |
| `--style`       | `business`, `creative`, `technical`, `marketing` | Auto-detect    |
| `--domain`      | Industry/niche                                   | Auto-detect    |
| `--audience`    | Target audience                                  | General        |
| `--tone`        | `formal`, `casual`, `authoritative`, `friendly`  | Neutral        |
| `--format`      | `markdown`, `plain`, `html`                      | markdown       |
| `--max-tokens`  | Output length                                    | 8192           |
| `--temperature` | Creativity level                                 | Mode-dependent |
| `--refine`      | Refine existing file instead                     | -              |
| `--make-human`  | Humanize output flag                             | false          |
| `--agent-swarm` | Enable parallel execution                        | false          |
| `--dry-run`     | Show plan without writing                        | false          |

## Examples

### Agriculture Domain

```bash
uv run scripts/write.py \
  "Write a blog post about drought-resistant corn varieties" \
  --domain agriculture \
  --audience "small-scale farmers" \
  --tone practical \
  --mode thinking
```

### Technical Documentation

```bash
uv run scripts/write.py \
  "Create API documentation for user authentication endpoints" \
  --style technical \
  --format markdown \
  --mode thinking
```

### Marketing Copy

```bash
uv run scripts/write.py \
  "Write Instagram captions for new farm equipment launch" \
  --style marketing \
  --audience "farm owners" \
  --tone enthusiastic \
  --mode instant
```

## Architecture

```
kimi-writing/
├── SKILL.md                    # This file
├── README.md                   # Quick start
├── scripts/
│   ├── write.py               # Main CLI entry
│   ├── modes.py               # Mode selection logic
│   ├── style_enforcer.py      # Anti-slop validation
│   └── domain_analyzer.py     # Niche detection
├── prompts/
│   ├── system.md              # Core system prompt
│   ├── metaprompt.md          # Writing metaprompt
│   └── styles/                # Domain-specific guides
│       ├── agriculture.md
│       ├── business.md
│       ├── creative.md
│       ├── marketing.md
│       └── technical.md
└── tools/
    ├── openrouter_client.py   # API wrapper
    └── writing_assistant.py   # Core logic
```

## Quality Checklist

All generated content passes through:

1. ✅ Anti-slop validation
2. ✅ Domain terminology check
3. ✅ Audience appropriateness
4. ✅ Purpose alignment
5. ✅ Voice consistency
6. ✅ Concrete detail requirement

## Troubleshooting

**Generic-sounding output:**

- Increase `--make-human` flag usage
- Try `thinking` mode for more nuance
- Add specific domain references

**Too technical/simplified:**

- Adjust `--audience` parameter
- Provide example text as reference
- Use `--tone` flag to calibrate

**Slow response:**

- Switch to `instant` mode
- Reduce `--max-tokens`
- Use `--dry-run` to preview first

## Notes

- K2.5 excels at long-horizon reasoning tasks
- 256K context window supports large documents
- Native multimodal can analyze reference images
- Agent swarm mode for parallel execution (experimental)

## Status

✅ Production Ready

- OpenRouter integration working
- Anti-slop guardrails implemented
- Domain detection functional
- CLI interface complete

Last Updated: February 4, 2026
