# Hermes Agent — DeepSeek V4 Compression & Reasoning Fix Guide

## Overview

This document covers two fixes for Hermes Agent when using DeepSeek V4 models with thinking mode:

1. **Compression context window fix** — Enable full 1M token context for compression
2. **DeepSeek reasoning_content fix** — Fix HTTP 400 errors with thinking mode enabled

---

## Part 1: Compression Context Window Fix

### The Problem

When using a main model with a large context window (e.g., DeepSeek V4 with 1M tokens), the compression threshold is set high (e.g., 85% = 850K tokens). However, if the compression model has a smaller context window, compression fails or gets auto-lowered.

```
⚠️ Compression model (MiniMax-M2.7-highspeed) context is 204,800 tokens,
but the main model's compression threshold was 850,000 tokens.
Auto-lowered this session's threshold to 204,800 tokens.
```

### The Fix

Update `config.yaml` to use a compression model with 1M+ context:

```yaml
auxiliary:
  compression:
    provider: opencode-go
    model: deepseek-v4-flash
    base_url: https://opencode.ai/zen/go/v1
    api_key: env:OPENCODE_API_KEY
    timeout: 45
    extra_body: {}
```

This uses **OpenCode Go's DeepSeek V4 Flash** which has:
- **1M token context window**
- **$5 first month / $10/month** subscription
- Generous request limits

### Why OpenCode Go?

- Already has DeepSeek V4 Flash available
- Only affects internal compression (never seen by users)
- Main chat model is unaffected — choose whatever model you want
- Other auxiliary tasks (vision, session_search, title_generation) remain unchanged

### Alternative: Use DeepSeek Direct

If you prefer not to use OpenCode Go:

```yaml
auxiliary:
  compression:
    provider: deepseek
    model: deepseek-v4-flash
    base_url: https://api.deepseek.com
    api_key: env:DEEPSEEK_API_KEY
    timeout: 45
    extra_body: {}
```

Requires your own DeepSeek API key with sufficient quota.

---

## Part 2: DeepSeek V4 Thinking Mode Reasoning Content Fix

### The Problem

When using DeepSeek V4 models with thinking mode enabled, multi-turn conversations fail with:

```
⚠️ Non-retryable error (HTTP 400) — trying fallback...
❌ Non-retryable error (HTTP 400): HTTP 400: Error from provider (DeepSeek):
The reasoning_content in the thinking mode must be passed back to the API.
```

### Root Cause

DeepSeek V4 with thinking mode enabled requires `reasoning_content` on **every** assistant message in the conversation history. The original fix only handled messages with `tool_calls`, missing plain text-only responses.

### The Fix

**Option A: Update Hermes Agent to latest (recommended)**

```bash
cd ~/.hermes/hermes-agent
git stash  # Save any local changes
git pull origin main
git stash pop  # Restore local changes
launchctl stop ai.hermes.gateway
launchctl start ai.hermes.gateway
```

Verify the fix is present:
```bash
grep -n "_needs_deepseek_tool_reasoning\|_copy_reasoning_content_for_api" run_agent.py
```

You should see commits like `ad0ac894` and `5ae60815` in the git log.

**Option B: Manual patch (if you can't update)**

In `run_agent.py`, locate `_copy_reasoning_content_for_api()` and ensure it has these sections:

```python
# Section 3: DeepSeek/Kimi tool-call turns need empty reasoning_content
needs_empty_reasoning = (
    source_msg.get("tool_calls")
    and (
        self._needs_kimi_tool_reasoning()
        or self._needs_deepseek_tool_reasoning()
    )
)
if needs_empty_reasoning:
    api_msg["reasoning_content"] = ""
    return

# Section 4: ALL DeepSeek/Kimi assistant messages need reasoning_content
if (
    self._needs_kimi_tool_reasoning()
    or self._needs_deepseek_tool_reasoning()
):
    api_msg["reasoning_content"] = ""
    return
```

Also add `deepseek-` prefix detection:

```python
def _needs_deepseek_tool_reasoning(self) -> bool:
    provider = (self.provider or "").lower()
    model = (self.model or "").lower()
    return (
        provider == "deepseek"
        or "deepseek" in model
        or base_url_host_matches(self.base_url, "api.deepseek.com")
    )
```

---

## Complete Example config.yaml Section

```yaml
model:
  default: deepseek-v4-pro
  provider: opencode-go
  base_url: https://opencode.ai/zen/go/v1
  api_key: env:OPENCODE_API_KEY
  api_mode: chat_completions

auxiliary:
  compression:
    provider: opencode-go
    model: deepseek-v4-flash
    base_url: https://opencode.ai/zen/go/v1
    api_key: env:OPENCODE_API_KEY
    timeout: 45
    extra_body: {}
```

---

## Verification Steps

1. **Restart Hermes** after config changes:
   ```bash
   launchctl stop ai.hermes.gateway
   launchctl start ai.hermes.gateway
   ```

2. **Test multi-turn conversation** with DeepSeek V4:
   ```
   /model deepseek-v4-pro --provider opencode-go
   hi
   what is 2+2?
   tell me about quantum computing
   ```

3. **Check logs** if errors occur:
   ```bash
   tail -f ~/.hermes/logs/gateway.log
   ```

4. **Verify compression** is using the correct context:
   ```
   /model deepseek-v4-pro
   [Send many messages to trigger compression]
   ```
   You should NOT see the "Auto-lowered threshold" warning.

---

## Troubleshooting

### Still getting reasoning_content errors after update?

If using a custom provider pointing to `api.deepseek.com`, ensure:
- Model name contains "deepseek" (case insensitive), OR
- Provider name is exactly "deepseek", OR
- Base URL host matches `api.deepseek.com`

### OpenCode Go API key issues?

Ensure your `OPENCODE_API_KEY` environment variable is set in your shell profile or launchd environment.

### Compression still not triggering at high threshold?

Verify the compression model has sufficient context:
```bash
curl -s -H "Authorization: Bearer $OPENCODE_API_KEY" \
  https://opencode.ai/zen/go/v1/models | grep -i v4-flash
```

---

## Related Issues

- Hermes Agent #15717: DeepSeek API 400 reasoning_content error
- Hermes Agent #15213: reasoning_content broken in auxiliary paths  
- Hermes Agent PR #15478: fix-deepseek-reasoning-all-assistant-messages
- Hermes Agent PR #15407: consolidated DeepSeek/Kimi reasoning fixes

---

## Contact

For issues specific to this setup, check:
- Hermes Agent GitHub: https://github.com/NousResearch/hermes-agent
- OpenCode Go: https://opencode.ai/go
