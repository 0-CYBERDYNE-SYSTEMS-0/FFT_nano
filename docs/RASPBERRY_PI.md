# Raspberry Pi Deployment (First-Class)

This guide is the authoritative Raspberry Pi install/start runbook for `FFT_nano`.

Target platform:
- Raspberry Pi OS 64-bit (Bookworm recommended)
- Raspberry Pi 4/5 with internet access

## 1. Preflight

Run these and confirm:

```bash
uname -m
cat /etc/os-release | head -n 3
```

Expected:
- `aarch64` (64-bit)
- Raspberry Pi OS Bookworm (or compatible Debian-based 64-bit)

## 2. Base packages

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
```

## 3. Install Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

`node -v` must report major version 20 or newer.

## 4. Install Docker and enable on boot

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
```

Important: log out and back in (or reboot) so Docker group membership applies.

Then:

```bash
sudo systemctl enable --now docker
docker info
```

`docker info` must succeed before continuing.

## 5. Clone and bootstrap FFT_nano

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git
cd FFT_nano
./scripts/setup.sh
```

What `setup.sh` does:
- installs deps
- typechecks and builds
- builds agent container image for Docker runtime
- scaffolds `.env` if missing

## 6. Configure `.env`

```bash
cp .env.example .env
```

At minimum set:
- provider (`PI_API`, `PI_MODEL`, and provider key)
- channel credentials (`TELEGRAM_BOT_TOKEN` and/or WhatsApp settings)

## 7. Start (manual)

Telegram-only recommended:

```bash
./scripts/start.sh telegram-only
```

Production style:

```bash
./scripts/start.sh start telegram-only
```

Debug mode:

```bash
./scripts/start.sh dev telegram-only
```

## 8. Make startup persistent (systemd)

Create service:

```bash
sudo tee /etc/systemd/system/fft-nano.service >/dev/null <<'EOF'
[Unit]
Description=FFT_nano
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/FFT_nano
ExecStart=/usr/bin/env bash -lc './scripts/start.sh start telegram-only'
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
```

Update these for your machine:
- `User=pi`
- `WorkingDirectory=/home/pi/FFT_nano`

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fft-nano
sudo systemctl status fft-nano --no-pager
```

Live logs:

```bash
journalctl -u fft-nano -f
```

## 9. Reboot validation (airtight check)

```bash
sudo reboot
```

After boot:

```bash
systemctl is-active docker
systemctl is-active fft-nano
journalctl -u fft-nano -n 100 --no-pager
```

Expected:
- both services `active`
- no startup loop errors in recent logs

## 10. Farm demo/production setup (optional)

From repo root:

```bash
./scripts/farm-bootstrap.sh --mode demo
# or
./scripts/farm-bootstrap.sh --mode production
```

This handles companion dashboard fetch, HA startup, and onboarding flow.

## 11. Update procedure

```bash
cd ~/FFT_nano
git pull --ff-only
./scripts/setup.sh
sudo systemctl restart fft-nano
```

## 12. Fast troubleshooting

Docker not reachable:

```bash
sudo systemctl restart docker
docker info
```

Service failed:

```bash
systemctl status fft-nano --no-pager
journalctl -u fft-nano -n 200 --no-pager
```

Node version mismatch:

```bash
node -v
```

If `< 20`, reinstall Node.js 20+ and rerun `./scripts/setup.sh`.
