# Environment Variables Reference

This document lists all environment variables that can be used to customize CLI behavior for coding agents.

## Core Environment Variables

### Command Override Variables

#### CLAUDE_CMD
Overrides the default Claude binary path.

**Usage:**
```bash
CLAUDE_CMD="/path/to/custom/claude" claude-start ZAI
```

**When to use:**
- Custom Claude installation location
- Testing with development builds
- Container or sandboxed environments

**Example:**
```bash
# Use specific Claude binary
CLAUDE_CMD="/usr/local/bin/claude-dev" claude-start ZAI

# Use containerized Claude
CLAUDE_CMD="docker run --rm -it anthropic/claude-cli" claude-start ZAI
```

#### DROID_CMD
Overrides the default Droid binary path.

**Usage:**
```bash
DROID_CMD="/path/to/custom/droid" droid-start ZAI
```

**When to use:**
- Custom Droid installation location
- Testing with development builds
- Multiple Droid versions

**Example:**
```bash
# Use specific Droid binary
DROID_CMD="/opt/droid/bin/droid-beta" droid-start ZAI
```

#### OPENCODE_CMD
Overrides the default OpenCode binary path.

**Usage:**
```bash
OPENCODE_CMD="/path/to/custom/opencode" opencode-start ZAI
```

**When to use:**
- Custom OpenCode installation location
- Testing with development builds
- Development environments

**Example:**
```bash
# Use specific OpenCode binary
OPENCODE_CMD="/usr/local/bin/opencode-dev" opencode-start ZAI
```

### Authentication Variables

#### ANTHROPIC_AUTH_TOKEN
Authentication token for Claude CLI.

**Usage:**
```bash
ANTHROPIC_AUTH_TOKEN="sk-ant-..." claude-start ZAI
```

**When to use:**
- Temporary authentication for single session
- CI/CD environments
- Testing with different tokens

**Example:**
```bash
# Test with different token
ANTHROPIC_AUTH_TOKEN="sk-ant-test..." claude-start ZAI --continue
```

#### ANTHROPIC_API_KEY
Alternative authentication variable for OpenCode CLI.

**Usage:**
```bash
ANTHROPIC_API_KEY="sk-ant-..." opencode-start ZAI
```

**When to use:**
- OpenCode-specific authentication
- Compatibility with other tools
- Environment-specific setup

**Example:**
```bash
# Use with OpenCode
ANTHROPIC_API_KEY="sk-ant-..." opencode-start ZAI --model anthropic/claude-sonnet-4-5
```

### Provider-Specific Variables

#### ZAI_API_KEY
Authentication for Z.AI provider.

**Usage:**
```bash
ZAI_API_KEY="zai_..." claude-start ZAI
```

**When to use:**
- Using ZAI profile
- Z.AI-specific authentication
- Multi-provider setups

#### MINIMAX_API_KEY
Authentication for MiniMax provider.

**Usage:**
```bash
MINIMAX_API_KEY="minimax_..." claude-start MinimaxM2.1
```

**When to use:**
- Using MiniMax profiles
- MiniMax-specific authentication
- Accessing MiniMax models

#### OPENROUTER_API_KEY
Authentication for OpenRouter provider.

**Usage:**
```bash
OPENROUTER_API_KEY="sk-or-..." claude-start deepseek-v3.2
```

**When to use:**
- Using OpenRouter profiles
- Accessing OpenRouter models
- Multiple model access

#### KIMI_API_KEY
Authentication for Kimi provider.

**Usage:**
```bash
KIMI_API_KEY="kimi_..." claude-start "kimi K2"
```

**When to use:**
- Using Kimi profile
- Korean/Asian language support
- Kimi-specific features

## Advanced Environment Configuration

### Multiple Variable Usage

Combine multiple environment variables for complex setups:

```bash
# Custom binary with specific token
CLAUDE_CMD="/usr/local/bin/claude-dev" \
ANTHROPIC_AUTH_TOKEN="sk-ant-..." \
claude-start ZAI --model claude-sonnet-4-5

# Custom Droid with OpenRouter token
DROID_CMD="/opt/droid/bin/droid-beta" \
OPENROUTER_API_KEY="sk-or-..." \
droid-start deepseek-v3.2 --continue
```

### Shell Profile Configuration

Add to ~/.bashrc or ~/.zshrc for permanent configuration:

```bash
# Default Claude command
export CLAUDE_CMD="/usr/local/bin/claude"

# Default tokens
export ANTHROPIC_AUTH_TOKEN="sk-ant-..."
export OPENROUTER_API_KEY="sk-or-..."

# Custom aliases
alias claude-start-dev="CLAUDE_CMD='/usr/local/bin/claude-dev' claude-start"
```

### Testing with Environment Variables

Test environment variable injection without launching CLI:

```bash
# Test Claude environment
claude-start ZAI --cmd "node -e \"console.log(process.env.ANTHROPIC_AUTH_TOKEN)\""

# Test Droid environment
droid-start ZAI --cmd "echo Testing with $ANTHROPIC_AUTH_TOKEN"

# Test OpenCode environment
opencode-start ZAI --cmd "node -e \"console.log(process.env.ANTHROPIC_API_KEY)\""
```

**Expected Output:**
```
claude-start ZAI --cmd "node -e \"console.log(process.env.ANTHROPIC_AUTH_TOKEN)\""
# Output: sk-ant-... (your actual token)
```

## Environment Variable Precedence

Environment variables override configuration files but are overridden by command-line flags:

1. **Command-line flags** (highest precedence)
   ```bash
   claude-start ZAI --model claude-sonnet-4-5
   ```

2. **Environment variables**
   ```bash
   ANTHROPIC_AUTH_TOKEN="..." claude-start ZAI
   ```

3. **Configuration files** (lowest precedence)
   - Profile configuration files
   - Default settings

## Security Best Practices

### Do
- Use environment variables for temporary authentication
- Rotate API keys regularly
- Use different tokens for development and production
- Test environment setup before production use

### Don't
- Commit API keys to version control
- Use production tokens in testing
- Share tokens across teams without rotation
- Log tokens in plain text

### Safe Usage Patterns

**Temporary token for single session:**
```bash
# Token only exists in this shell session
ANTHROPIC_AUTH_TOKEN="sk-ant-..." claude-start ZAI
# Token is cleared when shell closes
```

**Development vs Production:**
```bash
# Development
export ANTHROPIC_AUTH_TOKEN="sk-ant-dev-..."

# Production (different terminal/session)
export ANTHROPIC_AUTH_TOKEN="sk-ant-prod-..."
```

**CI/CD Usage:**
```bash
# In CI/CD pipeline
- name: Run Claude
  run: claude-start ZAI
  env:
    ANTHROPIC_AUTH_TOKEN: ${{ secrets.ANTHROPIC_TOKEN }}
```

## Troubleshooting

### Token Not Recognized
```bash
# Verify token is set
echo $ANTHROPIC_AUTH_TOKEN

# Test with explicit variable
ANTHROPIC_AUTH_TOKEN="sk-ant-..." claude-start ZAI --cmd "echo $ANTHROPIC_AUTH_TOKEN"
```

### Command Not Found
```bash
# Verify custom command path
ls -l $CLAUDE_CMD

# Test custom command
$CLAUDE_CMD --version
```

### Profile Not Found
```bash
# List all profiles
ai-claude-start list

# Check profile configuration
cat ~/.config/claude/profiles.json
```
