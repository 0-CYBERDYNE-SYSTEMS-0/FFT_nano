# Provider Setup Guide

This guide covers how to configure FFT_nano with different LLM providers. The provider determines which AI model powers your assistant.

## Quick Reference

| Provider | Models | API Type | Local? |
|----------|--------|----------|--------|
| [OpenAI](#openai) | GPT-4o, GPT-4o-mini, etc. | OpenAI API | No |
| [Anthropic](#anthropic) | Claude 3.5 Sonnet, Claude 3 Opus | Anthropic API | No |
| [Google Gemini](#google-gemini) | Gemini 2.0 Flash, Gemini 1.5 Pro | Google AI | No |
| [OpenRouter](#openrouter) | 100+ models | Unified API | No |
| [Ollama](#ollama) | Llama, Qwen, Mistral, etc. | OpenAI-compatible | Yes |
| [LM Studio](#lm-studio) | Any GGUF model | OpenAI-compatible | Yes |
| [Z.AI (GLM)](#zai-glm) | GLM-4.7, etc. | ZAI API | No |

---

## OpenAI

### 1. Get Your API Key

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click **Create new secret key**
3. Copy the key (starts with `sk-`)

### 2. Configure FFT_nano

```bash
# In your .env file:
PI_API=openai
PI_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-your-key-here

# Optional: Use a different OpenAI-compatible endpoint
# OPENAI_BASE_URL=https://api.openai.com/v1
```

### Recommended Models

| Model | Best For | Cost |
|-------|----------|------|
| `gpt-4o` | Best quality, slower | Higher |
| `gpt-4o-mini` | Good quality, fast, affordable | Lower |
| `gpt-4-turbo` | High quality | Medium |

### Verification

```bash
fft doctor
```

Expected output should show OpenAI as the active provider.

---

## Anthropic

### 1. Get Your API Key

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Click **Create Key**
3. Copy the key (starts with `sk-ant-`)

### 2. Configure FFT_nano

```bash
# In your .env file:
PI_API=anthropic
PI_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Recommended Models

| Model | Best For | Context |
|-------|----------|---------|
| `claude-3-5-sonnet-latest` | Balanced quality/speed | 200K |
| `claude-3-5-haiku-latest` | Fast, affordable | 200K |
| `claude-3-opus-latest` | Highest quality | 200K |

### Note on Thinking/Reasoning

Anthropic models support extended thinking. Enable with:

```bash
/reasoning on
```

Or set default in `.env`:

```bash
PI_REASONING=enabled
```

---

## Google Gemini

### 1. Get Your API Key

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **Create API Key**
3. Copy the key

### 2. Configure FFT_nano

```bash
# In your .env file:
PI_API=gemini
PI_MODEL=gemini-2.0-flash
GEMINI_API_KEY=your-key-here
```

### Recommended Models

| Model | Best For |
|-------|----------|
| `gemini-2.0-flash` | Fast, modern |
| `gemini-1.5-pro` | High context, complex tasks |
| `gemini-1.5-flash` | Balanced |

---

## OpenRouter

OpenRouter provides unified access to 100+ models from various providers.

### 1. Get Your API Key

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys)
2. Click **Create Key**
3. Copy the key

### 2. Configure FFT_nano

```bash
# In your .env file:
PI_API=openrouter
PI_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_API_KEY=sk-or-your-key-here
```

### Popular Models on OpenRouter

| Model | Provider | Best For |
|-------|----------|----------|
| `anthropic/claude-3.5-sonnet` | Anthropic | Balanced |
| `openai/gpt-4o` | OpenAI | High quality |
| `google/gemini-2.0-flash-exp` | Google | Fast |
| `meta-llama/llama-3.1-70b-instruct` | Meta | Large context |
| `deepseek/deepseek-chat-v3` | DeepSeek | Cost effective |

### Advanced Options

```bash
# Set OpenRouter-specific options
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_API_BASE=https://openrouter.ai/api/v1
```

---

## Ollama (Local)

Ollama runs open-source models locally on your machine.

### 1. Install Ollama

**macOS/Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows:** Download from [ollama.com/download](https://ollama.com/download)

### 2. Pull a Model

```bash
# List available models
ollama list

# Pull a model
ollama pull qwen2.5-coder-7b
ollama pull llama3.2
ollama pull mistral
```

### 3. Start Ollama Server

```bash
# Server starts automatically on install
# Verify it's running:
curl http://localhost:11434
```

### 4. Configure FFT_nano

```bash
# In your .env file:
PI_API=ollama
PI_MODEL=qwen2.5-coder-7b
OPENAI_BASE_URL=http://localhost:11434/v1
PI_API_KEY=ollama
```

### Available Ollama Models

| Model | Size | Best For |
|-------|------|----------|
| `qwen2.5-coder-7b` | ~4GB | Coding tasks |
| `qwen2.5-coder-3b` | ~2GB | Light coding |
| `llama3.2` | ~2GB | General |
| `mistral` | ~4GB | General |
| `codellama` | ~4GB | Coding |

### Troubleshooting Ollama

```bash
# Check if Ollama is running
curl http://localhost:11434

# Restart Ollama
# macOS:
launchctl stop ollama
launchctl start ollama

# Linux:
sudo systemctl restart ollama
```

---

## LM Studio (Local)

LM Studio runs any GGUF-format model locally with an OpenAI-compatible server.

### 1. Install LM Studio

Download from [lmstudio.ai](https://lmstudio.ai)

### 2. Download a Model

1. Open LM Studio
2. Search for a model (e.g., `qwen2.5-coder-7b`)
3. Download the GGUF file

### 3. Start the Local Server

1. Click **Server** (bottom left)
2. Set port (default: `1234`)
3. Click **Start Server**

### 4. Configure FFT_nano

```bash
# In your .env file:
PI_API=openai
PI_MODEL=qwen2.5-coder-7b-instruct
OPENAI_BASE_URL=http://127.0.0.1:1234/v1
PI_API_KEY=lm-studio
```

### Finding the Right Model Name

The model name in LM Studio's server tab must match exactly:

```bash
# If LM Studio shows "qwen2.5-coder-7b-instruct-Q4_K_M"
PI_MODEL=qwen2.5-coder-7b-instruct-Q4_K_M
```

---

## Z.AI (GLM)

### 1. Get Your API Key

1. Go to [bigmodel.cn](https://bigmodel.cn)
2. Sign up and get API credentials
3. Copy your ZAI_API_KEY

### 2. Configure FFT_nano

```bash
# In your .env file:
PI_API=zai
PI_MODEL=glm-4.7
ZAI_API_KEY=your-key-here
```

---

## Verification Checklist

After setup, verify your configuration:

```bash
# 1. Restart the service to pick up new .env
fft service restart

# 2. Check service health
fft service status
fft service logs

# 3. Run doctor
fft doctor

# 4. Test in Telegram
@YourBot /models
```

Expected `/models` output:
- Should list available models from your provider
- Should not show "No models available"

---

## Switching Providers

To switch providers:

1. Update your `.env`:
   ```bash
   PI_API=new-provider
   PI_MODEL=new-model
   NEW_PROVIDER_API_KEY=your-key
   ```

2. Restart:
   ```bash
   fft service restart
   ```

3. Verify:
   ```bash
   fft doctor
   ```

---

## Provider-Specific Notes

### Rate Limits

| Provider | Free Tier | Paid Tier |
|----------|-----------|-----------|
| OpenAI | 3 RPM | 500+ RPM |
| Anthropic | 50 req/min | Higher |
| Gemini | 15 RPM | 1000+ RPM |
| OpenRouter | Varies by model | Varies |

### Cost Management

- Set usage limits in provider dashboards
- Monitor with `/usage` command in Telegram
- Use smaller models for routine tasks

### Model Selection Tips

- **Coding tasks**: `qwen2.5-coder-7b` (Ollama/LM Studio) or `gpt-4o-mini`
- **Fast responses**: `gpt-4o-mini` or `claude-3-5-haiku`
- **Complex reasoning**: `claude-3-5-sonnet` or `gpt-4o`
- **Budget**: Ollama/LM Studio for local, OpenRouter for variety
