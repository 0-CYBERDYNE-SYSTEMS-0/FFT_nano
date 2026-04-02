---
name: debug
description: Debug FFT_nano agent runtime issues (Docker default, host opt-in). Use when agent execution fails, runtime checks fail, or onboarding/startup is blocked.
---

# FFT_nano Runtime Debugging

This guide covers host-side diagnosis for current runtime modes:
- Docker (default)
- Host runtime (advanced, explicit opt-in)

## Runtime Architecture

```
Host process (src/index.ts)
  -> runtime selection (src/container-runtime.ts)
  -> agent execution (src/container-runner.ts)
     - Docker mode: docker run fft_nano-agent:latest
     - Host mode: node container/agent-runner/dist/index.js
```

## Key Log Locations

| Log | Location | Purpose |
|---|---|---|
| App log | `logs/fft_nano.log` | Router, scheduler, runtime orchestration |
| App error log | `logs/fft_nano.error.log` | Host process failures |
| Runtime run log | `groups/<folder>/logs/runtime-*.log` | Per-run stdout/stderr, mounts, env diagnostics |

## Quick Health Checks

### 1) App build/runtime sanity

```bash
npm run typecheck
npm run build
```

### 2) Runtime mode resolution

```bash
node -e "import('./dist/container-runtime.js').then(m=>console.log(m.getContainerRuntime()))"
```

### 3) Docker availability (default)

```bash
docker --version
docker info >/dev/null && echo "Docker OK" || echo "Docker NOT running"
```

### 4) Host mode gating (advanced)

```bash
grep -E '^(CONTAINER_RUNTIME|FFT_NANO_ALLOW_HOST_RUNTIME|FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD)=' .env || true
```

Host mode requires:
- `CONTAINER_RUNTIME=host`
- `FFT_NANO_ALLOW_HOST_RUNTIME=1`

Production host mode additionally requires:
- `FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD=1`

## Common Failure Modes

### "Invalid CONTAINER_RUNTIME"

Cause: `.env` contains an unsupported value.

Fix:
```bash
sed -i.bak 's/^CONTAINER_RUNTIME=.*/CONTAINER_RUNTIME=auto/' .env
```

### "No supported runtime found"

Cause: Docker unavailable and host mode not explicitly allowed.

Fix options:
1. Start Docker Desktop / Docker daemon.
2. Or explicitly enable host mode in `.env`:
```bash
CONTAINER_RUNTIME=host
FFT_NANO_ALLOW_HOST_RUNTIME=1
```

### Runtime exits with code 1

Check newest runtime log:
```bash
ls -t groups/*/logs/runtime-*.log | head -1 | xargs -I{} sh -lc 'echo "== {} =="; tail -120 "{}"'
```

Then validate credentials:
```bash
grep -E '^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|PI_API|PI_MODEL|ZAI_API_KEY)=' .env
```

### Session resumption problems

Verify per-group session mount path exists:
```bash
ls -la data/pi/main/.pi 2>/dev/null || true
```

Ensure runtime logs show expected mounted session directory and no permission errors.

## Manual Runtime Smoke Tests

### Docker mode smoke

```bash
echo '{}' | docker run -i --entrypoint /bin/echo fft_nano-agent:latest "Container OK"
```

### Host mode smoke

```bash
npm --prefix container/agent-runner run build
CONTAINER_RUNTIME=host FFT_NANO_ALLOW_HOST_RUNTIME=1 FFT_NANO_DRY_RUN=1 npm run dev
```

## Service-level Checks (launchd)

```bash
launchctl list | grep fft_nano || true
launchctl kickstart -k gui/$(id -u)/com.fft_nano
sleep 2
tail -80 logs/fft_nano.log
```

## One-Pass Diagnostics Script

```bash
echo "1) Node/build"
node --version
npm run -s build >/dev/null && echo "build OK" || echo "build FAIL"

echo "\n2) Docker"
docker info >/dev/null 2>&1 && echo "docker OK" || echo "docker NOT ready"

echo "\n3) Runtime policy"
grep -E '^(CONTAINER_RUNTIME|FFT_NANO_ALLOW_HOST_RUNTIME|FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD)=' .env || echo "no runtime env overrides"

echo "\n4) Latest runtime logs"
ls -t groups/*/logs/runtime-*.log 2>/dev/null | head -3 || echo "no runtime logs yet"
```

## Escalation Data to Capture

If issue persists, capture and share:
1. `logs/fft_nano.log` tail (last 120 lines)
2. Latest `groups/<folder>/logs/runtime-*.log`
3. Output of `docker info` (or host mode env flags)
4. Current `.env` runtime keys (redact secrets)
