---
name: mcu-agent-ops
description: Build, flash, configure, and operate microcontroller-based agent firmware on ESP32-class devices with serial CLI management and troubleshooting.
compatibility: ESP-IDF tooling, compatible ESP32-class hardware, and serial access.
license: Follow the license of the selected upstream firmware runtime.
---

# MCU Agent Ops

Use this skill for setup, flashing, and day-2 operations of microcontroller agent firmware.

## When to use this skill

- Use for firmware build/flash on supported microcontrollers.
- Use for serial CLI configuration of connectivity and model providers.
- Use for runtime diagnostics on resource-constrained firmware nodes.

## When not to use this skill

- Do not use for Linux-native edge agent installations.
- Do not use for server-class daemon or gateway service management.
- Do not use when required toolchain or target hardware is unavailable.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Confirm serial port and target board before flashing.
- Never echo full secrets back to chat or logs.

## Compatibility mappings

- MimiClaw install/flash/ops workflows map to this skill.
- Similar ESP32-class agent firmware workflows map here.

## Standard flash flow

```bash
git clone <mcu-agent-repo>
cd <mcu-agent>
idf.py set-target esp32s3
cp main/secrets.h.example main/secrets.h
# edit secrets file locally
idf.py fullclean && idf.py build
idf.py -p /dev/<PORT> flash monitor
```

## Runtime serial operations

```text
wifi_status
wifi_set <ssid> <password>
set_api_key <key>
set_model_provider <provider>
set_model <model>
config_show
restart
```

## Troubleshooting checklist

1. No remote responses:
   - Verify Wi-Fi status and token presence.
2. Provider/model failures:
   - Reapply provider key and model pairing.
3. Flash failures:
   - Verify cable, port, target, and toolchain version.
4. Memory instability:
   - Check heap usage and reduce runtime workload.
