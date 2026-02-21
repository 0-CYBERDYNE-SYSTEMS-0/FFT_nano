# Raspberry Pi Deployment (First-Class)

This guide is the Raspberry Pi-specific addendum for `FFT_nano`.
Canonical install/run command reference lives in `README.md` ("Quickstart (Primary UX Path)").

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

## 8. Make startup persistent (service script)

The project service helper configures systemd for you:

```bash
./scripts/service.sh install
# or, if linked:
fft service install
```

Check health and logs:

```bash
./scripts/service.sh status
./scripts/service.sh logs
# or, after `npm link`: fft service status && fft service logs
```

Notes:
- `setup.sh` installs/starts the service by default unless `FFT_NANO_AUTO_SERVICE=0`.
- If status/restart needs elevated privileges on your host, run `./scripts/service.sh ...` (or `fft service ...`) from a shell with sufficient permissions.

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
./scripts/service.sh restart
# or, after `npm link`: fft service restart
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
