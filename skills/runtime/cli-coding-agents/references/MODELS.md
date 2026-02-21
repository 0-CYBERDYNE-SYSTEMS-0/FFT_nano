# Model Mappings and Specifications

This document provides detailed information about models available across different providers and their usage patterns.

## Model Overview

### Z.AI Models

#### GLM-4.7
- **Provider**: Z.AI
- **Model Name**: GLM-4.7
- **Usage**: General-purpose coding and analysis
- **Strengths**: Balanced performance, fast response times
- **CLI Support**: All three CLIs
- **Example Usage**:
  ```bash
  claude-start ZAI
  droid-start ZAI --model GLM-4.7
  opencode-start ZAI --model GLM-4.7
  ```

### MiniMax Models

#### MiniMax-M2.1
- **Provider**: MiniMax
- **Model Name**: minimax/minimax-m2.1
- **Usage**: Advanced reasoning and complex code analysis
- **Strengths**: Strong analytical capabilities, detailed explanations
- **CLI Support**: All three CLIs
- **Example Usage**:
  ```bash
  claude-start MinimaxM2.1
  droid-start MinimaxM2.1
  opencode-start MinimaxM2.1
  ```

#### minimax-m2.1
- **Provider**: MiniMax
- **Model Name**: minimax/minimax-m2.1
- **Usage**: Alternative configuration of M2.1
- **Strengths**: Consistent with MinimaxM2.1 but different profile setup
- **CLI Support**: All three CLIs
- **Example Usage**:
  ```bash
  claude-start M2.1
  droid-start M2.1
  opencode-start M2.1
  ```

### OpenRouter Models

#### deepseek/deepseek-v3.2
- **Provider**: OpenRouter
- **Model Name**: deepseek/deepseek-v3.2
- **Usage**: Deep code analysis and architectural reasoning
- **Strengths**: Excellent for understanding complex codebases
- **CLI Support**: All three CLIs
- **Example Usage**:
  ```bash
  claude-start deepseek-v3.2
  droid-start deepseek-v3.2
  opencode-start deepseek-v3.2
  ```

#### x-ai/grok-code-fast-1
- **Provider**: OpenRouter
- **Model Name**: x-ai/grok-code-fast-1
- **Usage**: Rapid code generation and prototyping
- **Strengths**: Very fast response times, good for quick iterations
- **CLI Support**: All three CLIs
- **Example Usage**:
  ```bash
  claude-start code-fast-1
  droid-start code-fast-1
  opencode-start code-fast-1
  ```

#### openai/gpt-oss-20b
- **Provider**: OpenRouter
- **Model Name**: openai/gpt-oss-20b
- **Usage**: Large-scale code processing and batch operations
- **Strengths**: Handles large codebases efficiently
- **CLI Support**: All three CLIs
- **Example Usage**:
  ```bash
  claude-start oss-120B
  droid-start oss-120B
  opencode-start oss-120B
  ```

### Kimi Models

#### Kimi Coding
- **Provider**: Kimi
- **Model Name**: Kimi Coding
- **Usage**: Code with Korean/Asian language support
- **Strengths**: Multi-language support, cultural context awareness
- **CLI Support**: All three CLIs
- **Example Usage**:
  ```bash
  claude-start "kimi K2"
  droid-start "kimi K2"
  opencode-start "kimi K2"
  ```

## Model Override Commands

Override the default model for a profile:

### Claude CLI Model Override
```bash
# Use ZAI profile with Claude Sonnet 4.5
claude-start ZAI --model claude-sonnet-4-5

# Use MinimaxM2.1 profile with Claude Opus 4.5
claude-start MinimaxM2.1 --model claude-opus-4-5

# Continue session with model override
claude-start --continue --model claude-sonnet-4-5
```

### Droid CLI Model Override
```bash
# Use ZAI profile with Claude Sonnet 4.5
droid-start ZAI --model claude-sonnet-4-5

# Use GLM-4.7 with custom model
droid-start GLM-4.7 --model custom-model-name

# Continue session with override
droid-start --continue --model claude-sonnet-4-5
```

### OpenCode CLI Model Override
```bash
# Use ZAI profile with Anthropic Claude Sonnet 4.5
opencode-start ZAI --model anthropic/claude-sonnet-4-5

# Use MinimaxM2.1 with OpenAI model
opencode-start MinimaxM2.1 --model openai/gpt-4

# Non-interactive mode with model override
opencode-start --run "explain this code" --model anthropic/claude-sonnet-4-5
```

## Model Compatibility Matrix

| Profile | CLI | Default Model | Can Override | Notes |
|---------|-----|---------------|--------------|-------|
| ZAI | Claude | GLM-4.7 | Yes | Default profile |
| ZAI | Droid | GLM-4.7 | Yes | Default profile |
| ZAI | OpenCode | GLM-4.7 | Yes | Default profile |
| MinimaxM2.1 | Claude | MiniMax-M2.1 | Yes | Advanced reasoning |
| MinimaxM2.1 | Droid | MiniMax-M2.1 | Yes | Advanced reasoning |
| MinimaxM2.1 | OpenCode | MiniMax-M2.1 | Yes | Advanced reasoning |
| deepseek-v3.2 | Claude | deepseek/deepseek-v3.2 | Yes | Deep analysis |
| deepseek-v3.2 | Droid | deepseek/deepseek-v3.2 | Yes | Deep analysis |
| deepseek-v3.2 | OpenCode | deepseek/deepseek-v3.2 | Yes | Deep analysis |
| code-fast-1 | Claude | x-ai/grok-code-fast-1 | Yes | Fast prototyping |
| code-fast-1 | Droid | x-ai/grok-code-fast-1 | Yes | Fast prototyping |
| code-fast-1 | OpenCode | x-ai/grok-code-fast-1 | Yes | Fast prototyping |
| oss-120B | Claude | openai/gpt-oss-20b | Yes | Large-scale processing |
| oss-120B | Droid | openai/gpt-oss-20b | Yes | Large-scale processing |
| oss-120B | OpenCode | openai/gpt-oss-20b | Yes | Large-scale processing |
| "kimi K2" | Claude | Kimi Coding | Yes | Multi-language |
| "kimi K2" | Droid | Kimi Coding | Yes | Multi-language |
| "kimi K2" | OpenCode | Kimi Coding | Yes | Multi-language |
| M2.1 | Claude | minimax/minimax-m2.1 | Yes | Alternative config |
| M2.1 | Droid | minimax/minimax-m2.1 | Yes | Alternative config |
| M2.1 | OpenCode | minimax/minimax-m2.1 | Yes | Alternative config |

## Provider Specifications

### Z.AI
- **Endpoint**: Custom Z.AI API
- **Authentication**: Z.AI API key
- **Rate Limits**: Varies by plan
- **Best For**: General coding tasks, balanced performance

### MiniMax
- **Endpoint**: MiniMax API
- **Authentication**: MiniMax API key
- **Rate Limits**: Varies by plan
- **Best For**: Advanced reasoning, detailed analysis

### OpenRouter
- **Endpoint**: OpenRouter API
- **Authentication**: OpenRouter API key
- **Rate Limits**: Varies by plan and model
- **Best For**: Access to multiple models through single API

### Kimi
- **Endpoint**: Kimi API
- **Authentication**: Kimi API key
- **Rate Limits**: Varies by plan
- **Best For**: Multi-language support, Asian markets
