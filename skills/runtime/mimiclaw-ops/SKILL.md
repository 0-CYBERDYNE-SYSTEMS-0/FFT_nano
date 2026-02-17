---
name: mimiclaw-ops
description: Install, flash, configure, and operate memovai/mimiclaw on ESP32-S3 edge devices, including runtime CLI management and troubleshooting.
compatibility: ESP-IDF v5.5+, ESP32-S3 board with 16MB flash and 8MB PSRAM, USB serial access.
license: Upstream mimiclaw is MIT licensed.
---

# MimiClaw Ops

Use this skill when the user asks to set up, update, debug, or operate [memovai/mimiclaw](https://github.com/memovai/mimiclaw) on ESP32-S3 hardware.

## When to use this skill

- Use for firmware build/flash and serial CLI configuration on ESP32-S3.
- Use for runtime operational tuning, provider switching, and maintenance.
- Use for edge deployment troubleshooting across WiFi, token, and model settings.

## When not to use this skill

- Do not use for Linux-native pico/zeroclaw install paths.
- Do not use when ESP-IDF tooling or target hardware is unavailable.
- Do not use to store secrets in repository files.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Treat Telegram token and API keys as secrets; never print full values back.
- Confirm target serial port before flashing firmware.

## Prerequisites

- ESP-IDF `v5.5+` installed and exported in the shell.
- ESP32-S3 dev board with `16MB flash` and `8MB PSRAM`.
- USB data cable connected to the board USB port used for flashing/monitoring.
- Required secrets:
  - WiFi SSID/password
  - Telegram bot token
  - Anthropic or OpenAI API key

## Standard Install and Flash

```bash
git clone https://github.com/memovai/mimiclaw.git
cd mimiclaw
idf.py set-target esp32s3
cp main/mimi_secrets.h.example main/mimi_secrets.h
# edit main/mimi_secrets.h with initial defaults
idf.py fullclean && idf.py build
idf.py -p /dev/<PORT> flash monitor
```

Notes:

- Run `idf.py fullclean` whenever `main/mimi_secrets.h` changes.
- On macOS, likely serial ports are under `/dev/cu.usb*`.
- If flashing fails, verify cable quality and the correct USB port on the board.

## Runtime Operations via Serial CLI

After boot, use MimiClaw CLI for no-rebuild reconfiguration:

```text
wifi_set <ssid> <password>
set_tg_token <token>
set_api_key <api_key>
set_model_provider anthropic
set_model claude-3-5-haiku-latest
set_proxy <host> <port>
clear_proxy
set_search_key <brave_key>
config_show
config_reset
```

Debug and maintenance:

```text
wifi_status
memory_read
memory_write "<content>"
heap_info
session_list
session_clear <chat_id>
heartbeat_trigger
cron_start
restart
```

## Recommended Provider Defaults

- Prefer `anthropic` provider for behavior parity with FFT_nano.
- Keep model choices small enough for edge latency/cost constraints.
- If provider switching is requested, apply `set_model_provider` and `set_model`, then verify with a test message in Telegram.

## Troubleshooting Checklist

1. No Telegram responses:
   - Verify WiFi with `wifi_status`.
   - Validate token via `config_show` (masked output expected).
   - Reboot using `restart`.
2. Model/API errors:
   - Re-set key with `set_api_key`.
   - Confirm provider/model pair compatibility.
3. Flash/build failures:
   - Re-run `idf.py fullclean && idf.py build`.
   - Confirm ESP-IDF version and target `esp32s3`.
4. Unstable memory or crashes:
   - Check `heap_info`.
   - Reduce prompt/tool complexity and retest.

## Integration Pattern for FFT_nano

- Use this skill as the operational runbook for deploying tiny edge assistants.
- Keep board-specific configuration in local operator notes; avoid embedding secrets in repository files.
- When requested, pair this with orchestration skills that manage rollout across multiple edge nodes.
