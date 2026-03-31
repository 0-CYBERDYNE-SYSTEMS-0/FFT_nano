# Installation Guide

This guide covers installing FFT_nano on different platforms. FFT_nano runs as a service on your machine, with the AI agent running inside an isolated Docker container by default.

## Prerequisites

All platforms require:

- **Node.js 20+**: [nodejs.org](https://nodejs.org)
- **Docker** (default runtime): [docker.com](https://docker.com)
- **Git**: [git-scm.com](https://git-scm.com)

Verify prerequisites:

```bash
node -v    # Must be 20 or higher
docker info  # Must show Docker is running
git --version
```

---

## macOS

### 1. Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install Prerequisites

```bash
brew install node@20 git
brew install --cask docker
```

### 3. Start Docker Desktop

```bash
open -a Docker
```

Wait for Docker to start (menubar icon stops spinning).

Verify:
```bash
docker info
```

### 4. Clone and Setup

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano
./scripts/onboard-all.sh
```

### 5. Service Management

The service runs as a macOS LaunchAgent.

```bash
# Install service
fft service install

# Start service
fft service start

# Check status
fft service status

# View logs
fft service logs
```

---

## Linux (Ubuntu/Debian)

### 1. Install Prerequisites

```bash
sudo apt update
sudo apt install -y git curl

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

**Important**: Log out and back in for Docker group to apply.

### 2. Enable Docker on Boot

```bash
sudo systemctl enable --now docker
```

### 3. Clone and Setup

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano
./scripts/onboard-all.sh
```

### 4. Service Management (systemd)

```bash
# Install service
sudo ./scripts/service.sh install

# Start service
sudo ./scripts/service.sh start

# Check status
sudo ./scripts/service.sh status

# View logs
sudo ./scripts/service.sh logs
```

---

## Raspberry Pi

Full guide: [RASPBERRY_PI.md](./RASPBERRY_PI.md)

### Quick Summary

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out/in, then:
sudo systemctl enable --now docker

# 4. Clone and setup
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano
./scripts/onboard-all.sh --runtime docker

# 5. Service
sudo ./scripts/service.sh install
sudo ./scripts/service.sh status
```

**Requirements:**
- Raspberry Pi OS 64-bit (Bookworm recommended)
- Raspberry Pi 4 or 5
- 4GB+ RAM recommended

---

## Windows (WSL2)

FFT_nano runs best on Linux via WSL2.

### 1. Enable WSL2

Open PowerShell as Administrator:

```powershell
wsl --install
```

Restart computer.

### 2. Install Docker Desktop

Download from [docker.com](https://docker.com) and enable WSL2 integration.

### 3. Open WSL Terminal

```bash
# Clone into WSL filesystem (faster than Windows mount)
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano
./scripts/onboard-all.sh
```

### 4. Service Management

```bash
# Install (runs in WSL)
./scripts/service.sh install

# Note: Service management commands must run in WSL
```

---

## Host Runtime (Advanced)

By default, FFT_nano runs the agent in an isolated Docker container. For development or advanced use, you can run directly on the host.

### Enabling Host Runtime

```bash
# In .env:
CONTAINER_RUNTIME=host
FFT_NANO_ALLOW_HOST_RUNTIME=1
FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD=1

# Restart service
fft service restart
```

### Host Runtime Requirements

Without Docker, you need:

```bash
# Install pi (the coding agent)
npm install -g pi-coding-agent

# Or via script
./scripts/setup.sh --runtime host
```

### When to Use Host Runtime

| Scenario | Recommended Runtime |
|----------|-------------------|
| Production use | Docker (default) |
| Local development | Docker or Host |
| Debugging agent code | Host |
| Resource-constrained Pi | Host (Docker may be slow) |

---

## Uninstallation

### 1. Stop and Remove Service

```bash
fft service stop
fft service uninstall
```

### 2. Remove Files

```bash
# Remove repo (optional - your data is in ~/nano)
rm -rf /path/to/FFT_nano

# Remove main workspace
rm -rf ~/nano
```

### 3. Docker Cleanup (optional)

```bash
# Remove FFT_nano containers
docker rm -f fft-nano-agent 2>/dev/null

# Remove images
docker rmi fft-nano-agent:latest 2>/dev/null
```

---

## Upgrading

### Standard Upgrade

```bash
cd FFT_nano
git pull

# Rebuild and restart
./scripts/setup.sh --runtime docker
fft service restart
```

### Preserving State

Before upgrading, backup your state:

```bash
npm run backup:state
```

Backups are stored in `./backups/`.

### After Upgrade

```bash
# Verify health
fft doctor

# Check logs
fft service logs
```

---

## Post-Installation Checklist

After installation, verify everything works:

- [ ] `fft service status` shows "active" or "running"
- [ ] `fft doctor` passes all checks
- [ ] Telegram bot responds to `/help`
- [ ] Telegram bot responds to `/status`
- [ ] Web UI accessible at http://127.0.0.1:28990

---

## Next Steps

1. **Configure your LLM provider**: See [PROVIDER_SETUP.md](./PROVIDER_SETUP.md)
2. **Set up Telegram**: See [README.md](../README.md) section on Telegram Operations
3. **Configure channels**: Edit `.env` with your `TELEGRAM_BOT_TOKEN`
4. **Claim admin**: DM your bot and run `/main <secret>`
