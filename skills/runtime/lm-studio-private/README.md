# LM Studio Private Integration

A Clawdbot skill for secure, private LLM and vision processing via LM Studio running on your Tailscale network.

## Quick Start

### 1. Verify LM Studio is Running
On your Mac Mini M2 Pro, ensure LM Studio is running:
- Open LM Studio
- Go to Settings → Local Server
- Verify "Enable Local Server" is checked
- Note the Tailscale IP (run `tailscale ip -4` on Mac Mini)

### 2. Test Connectivity
From your main computer:
```bash
curl http://100.72.41.118:1234/v1/models
```

Should return JSON with available models.

### 3. Use the Skill

**Via Python:**
```python
from lm_studio_private import lm_studio_chat, lm_studio_vision

# Chat
result = lm_studio_chat("Analyze this private document")

# Vision
result = lm_studio_vision("/path/to/image.jpg", "Extract text")
```

**Via Command Line:**
```bash
# Health check
python3 /Users/scrimwiggins/clawdbot/skills/lm-studio-private/tools/health.py

# Chat
python3 /Users/scrimwiggins/clawdbot/skills/lm-studio-private/tools/chat.py "Your prompt"

# Vision
python3 /Users/scrimwiggins/clawdbot/skills/lm-studio-private/tools/vision.py /path/to/image.jpg "Your prompt"

# List models
python3 /Users/scrimwiggins/clawdbot/skills/lm-studio-private/tools/models.py
```

**Via CB (Clawdbot):**
- "Use private LM for this"
- "Process with LM Studio"
- "Run vision analysis on local model"

## Features

- ✅ **Private Chat** - Text completion without leaving your network
- ✅ **Vision Analysis** - OCR, image description, UI analysis
- ✅ **Model Management** - List and switch between models
- ✅ **Health Monitoring** - Check connectivity and response times
- ✅ **Usage Tracking** - Token counting for cost awareness
- ✅ **Tailscale Encrypted** - All traffic end-to-end encrypted

## Requirements

- Python 3.8+
- LM Studio running on Mac Mini M2 Pro
- Tailscale installed and running on both machines
- Dependencies: `requests`, `PIL` (Pillow)

Install dependencies:
```bash
python3 -m pip install --break-system-packages requests pillow
```

## Network Setup

```
Mac Mini M2 Pro (LM Studio)
├── Tailscale IP: 100.72.41.118
└── API Port: 1234
    └── Endpoint: http://100.72.41.118:1234/v1/chat/completions

Your Computer (CB Instance)
└── Tailscale IP: 100.98.195.126
    └── Can reach LM Studio via Tailscale (encrypted)
```

## Configuration

Edit `/Users/scrimwiggins/clawd/TOOLS.md` to update:
- Tailscale IP address
- API port
- Default model settings

## API Reference

### lm_studio_chat(prompt, model, max_tokens, temperature)
Send text completion request to LM Studio.

**Parameters:**
- `prompt` (str, required): Text prompt
- `model` (str, optional): Model ID (default: mistralai/ministral-3-3b)
- `max_tokens` (int, optional): Max output tokens (default: 2000)
- `temperature` (float, optional): Sampling temperature 0.0-1.0 (default: 0.7)

**Returns:** Response text + usage info

### lm_studio_vision(image_path, prompt, model, max_tokens)
Analyze image with LM Studio's vision model.

**Parameters:**
- `image_path` (str, required): Absolute path to image
- `prompt` (str, required): What to analyze
- `model` (str, optional): Vision model ID (default: jan-v2-vl-high)
- `max_tokens` (int, optional): Max output tokens (default: 1000)

**Returns:** Analysis text + usage info

### lm_studio_models(format)
List all available models.

**Parameters:**
- `format` (str, optional): "table", "json", or "list" (default: table)

**Returns:** Formatted model list

### lm_studio_health()
Check if LM Studio is accessible.

**Returns:** Status info with response time and model count

## Available Models

Default configuration includes:
- **mistralai/ministral-3-3b** - Chat, reasoning, code
- **jan-v2-vl-high** - Vision/multimodal
- **glm-4.7-flash** - Fast chat
- **text-embedding-nomic-embed-text-v1.5** - Text embeddings
- **nvidia/nemotron-3-nano** - Compact reasoning
- And more (use `lm_studio_models()` to see all)

## Privacy & Security

✅ **100% Private:** All processing on Mac Mini M2 Pro
✅ **Tailscale Encrypted:** End-to-end encryption
✅ **No Public APIs:** Never touches OpenAI/Anthropic/etc.
✅ **Zero Logging:** Configure LM Studio with zero logging
✅ **Local Models Only:** Ministral-3-3B runs entirely on hardware

## Troubleshooting

### Connection Failed
```bash
# Check LM Studio is running
curl http://100.72.41.118:1234/v1/models

# Check Tailscale
tailscale status

# Verify IP address
tailscale ip -4
```

### Model Not Found
```bash
# List available models
python3 /path/to/skill/tools/models.py
```

### Vision Not Working
- Check image path is absolute (starts with `/`)
- Ensure image format is supported (jpg, png, webp)
- Verify vision model is loaded in LM Studio

## File Structure

```
/Users/scrimwiggins/clawdbot/skills/lm-studio-private/
├── SKILL.md                 # Full documentation
├── README.md               # This file
├── TEST_RESULTS.md         # Test verification
├── __init__.py            # Package initialization
├── client.py              # HTTP client for LM Studio
└── tools/
    ├── chat.py            # Chat completion
    ├── vision.py          # Vision analysis
    ├── models.py          # Model listing
    └── health.py         # Health check
```

## Usage Examples

### Private Data Processing
```markdown
You: "Analyze these financial records using LM Studio"
CB: [Uses lm_studio_chat() → 100% private processing]
```

### Vision Analysis
```markdown
You: "Read this screenshot with private model"
CB: [Uses lm_studio_vision() → Extracts text/analyzes locally]
```

### Code Generation
```markdown
You: "Generate Python script using Ministral"
CB: [Uses lm_studio_chat() → Returns code]
```

## License

This skill is part of Clawdbot and follows the same licensing terms.

---

**Skill Version:** 1.0.0
**Created:** January 26, 2026
**Status:** ✅ Production Ready
**Maintainer:** Farm Friend Terminal
