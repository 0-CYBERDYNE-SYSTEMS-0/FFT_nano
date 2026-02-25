---
name: convert-to-docker
description: Normalize FFT_nano to Docker-first runtime defaults. Use when user asks for Docker parity, cross-platform setup, or to disable host runtime mode.
disable-model-invocation: true
---

# Convert to Docker (Current Runtime Policy)

This repository now supports two runtime modes:
- `docker` (preferred/default)
- `host` (advanced, explicit opt-in)

This skill enforces Docker-first configuration and verifies the runtime end-to-end.

## 1. Verify Docker Is Installed and Running

```bash
docker --version
docker info >/dev/null && echo "Docker ready" || echo "Docker not ready"
```

If Docker is missing:
- macOS: install Docker Desktop from https://www.docker.com/products/docker-desktop/
- Linux: `curl -fsSL https://get.docker.com | sh && sudo systemctl start docker`

## 2. Set Docker Runtime Defaults

Update `.env` so Docker is selected and host-mode overrides are removed:

```bash
# ensure runtime is docker-first auto mode
if grep -q '^CONTAINER_RUNTIME=' .env 2>/dev/null; then
  sed -i.bak 's/^CONTAINER_RUNTIME=.*/CONTAINER_RUNTIME=auto/' .env
else
  echo 'CONTAINER_RUNTIME=auto' >> .env
fi

# remove host runtime opt-ins if present
sed -i.bak '/^FFT_NANO_ALLOW_HOST_RUNTIME=/d' .env
sed -i.bak '/^FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD=/d' .env
```

## 3. Build Runtime Artifacts

```bash
./container/build.sh
npm run build
```

## 4. Verify Agent Runtime

```bash
echo '{}' | docker run -i --entrypoint /bin/echo fft_nano-agent:latest "Container OK"
```

## 5. Verify Setup Path

Run the project setup checker (Docker path):

```bash
bash scripts/setup.sh
```

Expected behavior:
- Detects Docker runtime
- Builds/uses Docker image
- Passes runtime smoke checks

## 6. Restart Service

```bash
launchctl kickstart -k gui/$(id -u)/com.fft_nano
```

## Notes

- Do not set `CONTAINER_RUNTIME=host` unless explicitly requested.
- Host mode is intentionally gated by `FFT_NANO_ALLOW_HOST_RUNTIME=1`.
- Docker is the supported default for parity and operational consistency.
