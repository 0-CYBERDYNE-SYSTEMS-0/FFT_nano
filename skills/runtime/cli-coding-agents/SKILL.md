---
name: cli-coding-agents
description: CLI Coding Agents.
---

# CLI Coding Agents

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

Launch coding agents across Claude, Droid, and OpenCode CLI platforms with unified profile management and flexible configuration.

## Quick Start

### Profile Management (All CLIs)

**List all profiles:**
```bash
ai-claude-start list
ai-droid-start list
ai-opencode-start list
```

**Setup wizard:**
```bash
ai-claude-start setup
ai-droid-start setup
ai-opencode-start setup
```

**Set default profile:**
```bash
ai-claude-start default <profile-name>
ai-droid-start default <profile-name>
ai-opencode-start default <profile-name>
```

**Delete profile:**
```bash
ai-claude-start delete <profile-name>
ai-droid-start delete <profile-name>
ai-opencode-start delete <profile-name>
```

**System health check:**
```bash
ai-claude-start doctor
ai-droid-start doctor
ai-opencode-start doctor
```

### Launch Commands

#### Claude CLI

**Basic launch:**
```bash
claude-start                           # Uses default profile (ZAI)
claude-start ZAI                       # Use specific profile
claude-start MinimaxM2.1
```

**With flags (passed to Claude):**
```bash
claude-start --continue                   # Continue last session
claude-start ZAI --model claude-sonnet-4-5  # Override model
claude-start --dangerously-skip-permissions --continue
```

**Cross-command invocation:**
```bash
ai-claude-start ZAI                    # Uses Claude binary
ai-droid-start --claude ZAI           # Force Claude from droid-start
ai-opencode-start --claude ZAI        # Force Claude from opencode-start
```

#### Droid CLI

**Basic launch:**
```bash
droid-start                            # Uses default profile (ZAI)
droid-start ZAI                        # Use specific profile
droid-start deepseek-v3.2
```

**With flags (passed to Droid):**
```bash
droid-start --continue
droid-start GLM-4.7 --model claude-sonnet-4-5  # Override model
```

**Cross-command invocation:**
```bash
ai-droid-start ZAI                     # Uses Droid binary
ai-claude-start --droid ZAI            # Force Droid from claude-start
ai-opencode-start --droid ZAI          # Force Droid from opencode-start
```

#### OpenCode CLI

**Basic launch:**
```bash
opencode-start                          # Uses default profile (ZAI)
opencode-start ZAI                      # Use specific profile
opencode-start code-fast-1
```

**With flags (passed to OpenCode):**
```bash
opencode-start --continue                # Continue last session
opencode-start ZAI --model anthropic/claude-sonnet-4-5  # Override model
opencode-start --run "explain this file"  # Non-interactive mode
```

**Cross-command invocation:**
```bash
ai-opencode-start ZAI                  # Uses OpenCode binary
ai-claude-start --opencode ZAI         # Force OpenCode from claude-start
ai-droid-start --opencode ZAI          # Force OpenCode from droid-start
```

## Profile × CLI Combinations

### With Claude
```bash
claude-start ZAI              # GLM-4.7 via Z.AI
claude-start MinimaxM2.1      # MiniMax-M2.1 via MiniMax
claude-start deepseek-v3.2     # deepseek/deepseek-v3.2 via OpenRouter
claude-start code-fast-1       # x-ai/grok-code-fast-1 via OpenRouter
claude-start oss-120B          # openai/gpt-oss-20b via OpenRouter
claude-start "kimi K2"         # Kimi Coding via Kimi
claude-start M2.1               # minimax/minimax-m2.1 via MiniMax
```

### With Droid
```bash
droid-start ZAI               # GLM-4.7 via Z.AI
droid-start MinimaxM2.1       # MiniMax-M2.1 via MiniMax
droid-start deepseek-v3.2      # deepseek/deepseek-v3.2 via OpenRouter
droid-start code-fast-1        # x-ai/grok-code-fast-1 via OpenRouter
droid-start oss-120B           # openai/gpt-oss-20b via OpenRouter
droid-start "kimi K2"          # Kimi Coding via Kimi
droid-start M2.1                # minimax/minimax-m2.1 via MiniMax
```

### With OpenCode
```bash
opencode-start ZAI            # GLM-4.7 via Z.AI
opencode-start MinimaxM2.1    # MiniMax-M2.1 via MiniMax
opencode-start deepseek-v3.2   # deepseek/deepseek-v3.2 via OpenRouter
opencode-start code-fast-1     # x-ai/grok-code-fast-1 via OpenRouter
opencode-start oss-120B        # openai/gpt-oss-20b via OpenRouter
opencode-start "kimi K2"       # Kimi Coding via Kimi
opencode-start M2.1             # minimax/minimax-m2.1 via MiniMax
```

## Advanced Usage

### Environment Variable Overrides

**Custom Claude command:**
```bash
CLAUDE_CMD="/path/to/custom/claude" claude-start ZAI
```

**Custom Droid command:**
```bash
DROID_CMD="/path/to/custom/droid" droid-start ZAI
```

**Custom OpenCode command:**
```bash
OPENCODE_CMD="/path/to/custom/opencode" opencode-start ZAI
```

### Testing with Custom Commands

**Test environment injection (doesn't actually launch CLI):**
```bash
claude-start ZAI --cmd "node -e \"console.log(process.env.ANTHROPIC_AUTH_TOKEN)\""
droid-start ZAI --cmd "echo Testing with $ANTHROPIC_AUTH_TOKEN"
opencode-start ZAI --cmd "node -e \"console.log(process.env.ANTHROPIC_API_KEY)\""
```

### Profile Selection

**Use default profile (interactive if multiple):**
```bash
claude-start
```

**Use specific profile:**
```bash
claude-start ZAI
```

**Interactive selection (if multiple profiles):**
```bash
claude-start
# Prompts: "Select a profile to use:"
#   ZAI (default)
#   MinimaxM2.1
#   deepseek-v3.2
#   ...
```

## Reference Files

For detailed information, see:
- [PROFILES.md](references/PROFILES.md) - Available profiles and their configurations
- [MODELS.md](references/MODELS.md) - Model mappings and specifications
- [ENV_VARS.md](references/ENV_VARS.md) - Environment variables reference
