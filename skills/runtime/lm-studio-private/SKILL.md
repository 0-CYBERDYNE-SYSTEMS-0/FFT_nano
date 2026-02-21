---
name: lm-studio-private
description: "Private LLM and vision via LM Studio. Auto-loads models. For text chat, code, image analysis. Default: mistralai/ministral-3-3b"
---

# LM Studio Private Integration

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

Private LLM and vision via LM Studio. **Auto-loads models automatically!**

## Quick Start

```python
from client import lm_studio_chat, lm_studio_vision, lm_studio_health

# Chat - auto-loads model if needed
lm_studio_chat("Hello!")

# Vision - auto-loads model if needed  
lm_studio_vision("/path/to/image.jpg", "What's in this image?")

# Check status
lm_studio_health()
```

## Features

- Auto-loading of models
- Auto-starts LM Studio if not running
- Vision analysis support
- Remote via Tailscale

## Configuration

| Setting | Value |
|---------|-------|
| Host | 100.72.41.118 |
| Port | 1234 |
| Auto-load | Enabled |
| Default Model | mistralai/ministral-3-3b |

## Functions

- `lm_studio_chat(prompt, model=None)` - Chat with auto-load
- `lm_studio_vision(image_path, prompt, model=None)` - Vision with auto-load
- `lm_studio_health()` - Check status
- `lm_studio_models()` - List models
