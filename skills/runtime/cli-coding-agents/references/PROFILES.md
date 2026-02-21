# Profile Configurations

This document lists all available profiles and their configurations across the three CLI platforms.

## Profile List

### ZAI Profile
- **Provider**: Z.AI
- **Model**: GLM-4.7
- **Usage**: Default profile for general coding tasks
- **CLI Support**: All three CLIs (Claude, Droid, OpenCode)
- **Command Examples**:
  ```bash
  claude-start ZAI
  droid-start ZAI
  opencode-start ZAI
  ```

### MinimaxM2.1 Profile
- **Provider**: MiniMax
- **Model**: MiniMax-M2.1
- **Usage**: Advanced coding and analysis
- **CLI Support**: All three CLIs
- **Command Examples**:
  ```bash
  claude-start MinimaxM2.1
  droid-start MinimaxM2.1
  opencode-start MinimaxM2.1
  ```

### deepseek-v3.2 Profile
- **Provider**: OpenRouter
- **Model**: deepseek/deepseek-v3.2
- **Usage**: Deep code analysis and reasoning
- **CLI Support**: All three CLIs
- **Command Examples**:
  ```bash
  claude-start deepseek-v3.2
  droid-start deepseek-v3.2
  opencode-start deepseek-v3.2
  ```

### code-fast-1 Profile
- **Provider**: OpenRouter
- **Model**: x-ai/grok-code-fast-1
- **Usage**: Fast code generation and prototyping
- **CLI Support**: All three CLIs
- **Command Examples**:
  ```bash
  claude-start code-fast-1
  droid-start code-fast-1
  opencode-start code-fast-1
  ```

### oss-120B Profile
- **Provider**: OpenRouter
- **Model**: openai/gpt-oss-20b
- **Usage**: Large-scale code processing
- **CLI Support**: All three CLIs
- **Command Examples**:
  ```bash
  claude-start oss-120B
  droid-start oss-120B
  opencode-start oss-120B
  ```

### kimi K2 Profile
- **Provider**: Kimi
- **Model**: Kimi Coding
- **Usage**: Korean/Asian language support in code
- **CLI Support**: All three CLIs
- **Command Examples**:
  ```bash
  claude-start "kimi K2"
  droid-start "kimi K2"
  opencode-start "kimi K2"
  ```

### M2.1 Profile
- **Provider**: MiniMax
- **Model**: minimax/minimax-m2.1
- **Usage**: Alternative MiniMax configuration
- **CLI Support**: All three CLIs
- **Command Examples**:
  ```bash
  claude-start M2.1
  droid-start M2.1
  opencode-start M2.1
  ```

## Profile Management Commands

### List Profiles
Show all configured profiles:
```bash
ai-claude-start list
ai-droid-start list
ai-opencode-start list
```

### Setup Wizard
Initialize or reconfigure profiles:
```bash
ai-claude-start setup
ai-droid-start setup
ai-opencode-start setup
```

### Set Default Profile
Make a profile the default for all launches:
```bash
ai-claude-start default ZAI
ai-droid-start default MinimaxM2.1
ai-opencode-start default code-fast-1
```

### Delete Profile
Remove a profile from configuration:
```bash
ai-claude-start delete old-profile
ai-droid-start delete unused-profile
ai-opencode-start delete test-profile
```

### Health Check
Verify all profiles are working correctly:
```bash
ai-claude-start doctor
ai-droid-start doctor
ai-opencode-start doctor
```

## Profile Selection Patterns

### Interactive Selection
When multiple profiles exist, launching without a profile name triggers interactive selection:
```bash
claude-start
# Output:
# Select a profile to use:
#   ZAI (default)
#   MinimaxM2.1
#   deepseek-v3.2
#   code-fast-1
#   oss-120B
#   "kimi K2"
#   M2.1
```

### Direct Profile Launch
Launch directly with a specific profile:
```bash
claude-start ZAI
```

### Override Model
Use profile with different model:
```bash
claude-start ZAI --model claude-sonnet-4-5
droid-start MinimaxM2.1 --model claude-opus-4-5
opencode-start deepseek-v3.2 --model anthropic/claude-sonnet-4-5
```

## Cross-CLI Profile Usage

Any profile can be used with any CLI by prefixing the command:
```bash
# Use ZAI profile with Droid CLI
ai-droid-start ZAI

# Use MinimaxM2.1 with OpenCode CLI
ai-opencode-start MinimaxM2.1

# Use deepseek-v3.2 with Claude CLI
ai-claude-start deepseek-v3.2
```

Or force a specific CLI:
```bash
# Force Claude binary with ZAI profile
claude-start ZAI

# Force Droid binary with ZAI profile
droid-start ZAI

# Force OpenCode binary with ZAI profile
opencode-start ZAI
```
