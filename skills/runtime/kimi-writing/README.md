# Kimi-K2.5 Writing Skill

Professional and creative writing assistant powered by Moonshot AI's Kimi-K2.5 model via OpenRouter.

## Quick Start

```bash
cd /Users/scrimwiggins/clawdbot/skills/kimi-writing

# Install dependencies
uv pip install -e .

# Set API key
export OPENROUTER_API_KEY="sk-or-v1-..."

# Test the skill
uv run scripts/write.py "Write a landing page for farm tech SaaS" \
  --mode thinking \
  --style marketing \
  --audience "farmers"
```

## Features

- **Anti-AI Slop Guardrails** - Content sounds human, not generic
- **Domain Awareness** - Agriculture, tech, business, creative, marketing, technical
- **Dual Modes** - Thinking (deep reasoning) vs Instant (quick output)
- **CLI Interface** - Easy command-line usage
- **Humanize Option** - Make output sound naturally human-written

## Installation

```bash
cd /Users/scrimwiggins/clawdbot/skills/kimi-writing
uv pip install -e .
```

## API Key

Get your key from [OpenRouter](https://openrouter.ai/keys):

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

Or create a `.env` file:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

## Usage

### Basic Writing

```bash
uv run scripts/write.py "Write a blog post about precision agriculture" \
  --domain agriculture \
  --tone practical \
  --make-human
```

### Refine Existing Content

```bash
uv run scripts/write.py refine draft.md \
  --style professional \
  --make-human
```

### Dry Run (Analysis Only)

```bash
uv run scripts/write.py "create whitepaper" --dry-run
```

### Options

| Option          | Description                                      |
| --------------- | ------------------------------------------------ |
| `--mode`        | `thinking` or `instant` (default: auto)          |
| `--domain`      | `agriculture`, `technology`, `business`, etc.    |
| `--style`       | `business`, `creative`, `technical`, `marketing` |
| `--tone`        | `formal`, `casual`, `authoritative`, `neutral`   |
| `--make-human`  | Humanize output                                  |
| `--output FILE` | Write to file                                    |
| `--dry-run`     | Show analysis without generating                 |

## Directory Structure

```
kimi-writing/
├── SKILL.md              # Full documentation
├── README.md             # This file
├── pyproject.toml        # Project config
├── scripts/
│   ├── write.py         # Main CLI entry
│   ├── domain_analyzer.py
│   └── modes.py
├── prompts/
│   ├── system.md        # Core prompt
│   └── styles/          # Domain guides
└── tools/
    └── openrouter_client.py
```

## Domain Support

- **Agriculture** - Farming, crops, equipment, precision ag
- **Technology** - APIs, devops, infrastructure
- **SaaS** - Churn, ARR, onboarding
- **Marketing** - Copy, CTAs, campaigns
- **Business** - Reports, proposals, strategy
- **Creative** - Stories, narratives, scripts
- **Technical** - Documentation, tutorials

## Mode Selection

**Thinking Mode (t=1.0):**

- Complex reasoning tasks
- Long-form content (articles, whitepapers)
- Nuanced narratives

**Instant Mode (t=0.6):**

- Quick copy
- Headlines, CTAs
- Speed-focused tasks

## Health Check

```bash
uv run scripts/write.py --health-check
```

## License

MIT
