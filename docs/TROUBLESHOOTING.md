# Troubleshooting Guide

Common issues and their solutions for FFT_nano.

## Quick Diagnostics

Run these first when something isn't working:

```bash
# 1. Check service status
fft service status

# 2. View recent logs
fft service logs

# 3. Run health check
fft doctor
```

---

## Service Won't Start

### Symptoms
- `fft service status` shows "stopped" or "inactive"
- Service starts but immediately exits

### Diagnosis

```bash
# View detailed logs
fft service logs

# Check for error messages
fft service logs 2>&1 | grep -i error
```

### Common Causes

**Port already in use:**
```
Error: EADDRINUSE 127.0.0.1:28989
```
Solution:
```bash
# Find what's using the port
lsof -i :28989

# Change FFT_nano port in .env:
FFT_NANO_TUI_PORT=28990
```

**Docker daemon not running:**
```
Error: Cannot connect to Docker daemon
```
Solution:
```bash
# macOS:
open -a Docker
wait for menubar icon to stabilize

# Linux:
sudo systemctl start docker
sudo systemctl enable docker
```

**Missing environment variables:**
```
Error: PI_API is required
```
Solution:
```bash
# Copy and edit .env
cp .env.example .env
# Edit .env with your provider settings
fft service restart
```

**Node version too old:**
```
Error: Node version must be >= 20
```
Solution:
```bash
# Check version
node -v

# Update Node.js (macOS)
brew upgrade node@20

# Update Node.js (Linux)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## Telegram Not Responding

### Symptoms
- Bot doesn't reply to messages
- `/help` returns nothing

### Diagnosis

```bash
# Check Telegram configuration
fft doctor

# View Telegram-specific logs
fft service logs | grep -i telegram
```

### Common Causes

**Wrong bot token:**
```
Error: 401: Unauthorized
```
Solution:
1. Check `TELEGRAM_BOT_TOKEN` in `.env`
2. Verify token from [@BotFather](https://t.me/BotFather)
3. Restart: `fft service restart`

**Bot not started with users:**
Solution: Users must send `/start` to the bot first.

**Multiple bot instances:**
```
Conflict: terminated by other getUpdates request
```
Solution:
```bash
# Kill any duplicate processes
pkill -f "node.*fft"
fft service restart
```

**No main chat claimed:**
The bot only responds in the main chat by default.
```bash
# In bot DM, run:
/id  # Get your chat ID
/main <your-secret>  # Claim as admin
```

---

## Agent Not Responding

### Symptoms
- Messages sent but no reply
- Router working but Pi not responding

### Diagnosis

```bash
# Check Pi runtime
fft service logs | grep -i "pi\|runtime"

# Test with dry run
FFT_NANO_DRY_RUN=1 fft service restart
fft service logs | grep -i dry
```

### Common Causes

**Missing or wrong API key:**
```
Error: No models available
```
Solution:
```bash
# Verify API key is set
grep API_KEY .env

# Test key directly
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models
```

**Wrong provider/model combination:**
```
Error: Model 'anthropic/gpt-4o' not found
```
Solution:
- Check `PI_API` matches your provider
- Check `PI_MODEL` is valid for that provider
- See [PROVIDER_SETUP.md](./PROVIDER_SETUP.md)

**Docker container issues:**
```bash
# Check container logs
docker logs fft-nano-agent 2>&1 | tail -50

# Rebuild container
docker rm -f fft-nano-agent
fft service restart
```

**Container out of disk space:**
```
Error: no space left on device
```
Solution:
```bash
# Clean Docker
./scripts/docker-recover.sh

# Or manually:
docker system prune -a
fft service restart
```

---

## Docker Issues

### Docker Won't Start (macOS)

1. Open Docker Desktop
2. Wait for "Docker Desktop is running"
3. If stuck, quit and restart Docker Desktop

### Docker Won't Start (Linux)

```bash
sudo systemctl status docker
sudo systemctl start docker
sudo systemctl enable docker
```

### Cannot Connect to Docker

```bash
# Verify Docker is running
docker info

# Add user to docker group
sudo usermod -aG docker $USER
# Log out and back in

# Test
docker ps
```

### Docker Disk Space Issues

```bash
# Check disk usage
docker system df

# Clean unused resources
docker system prune -a

# Or use recovery script
./scripts/docker-recover.sh
```

---

## Web UI Issues

### Cannot Access http://127.0.0.1:28990

```bash
# Check service is running
fft service status

# Check port binding
lsof -i :28990

# Check FFT_NANO_WEB_ENABLED=1 in .env
grep WEB .env
```

### Web UI Shows Blank Page

```bash
# Clear browser cache
# Try incognito/private window

# Check for JavaScript errors
# Open DevTools (F12) -> Console tab
```

---

## TUI (Terminal UI) Issues

### Cannot Connect to TUI

```
connect ECONNREFUSED 127.0.0.1:28989
```

Solution:
```bash
# Check TUI is enabled
grep TUI .env

# Check service is running
fft service status

# Restart service
fft service restart
```

### TUI Shows "unknown session: main"

```bash
# No main chat registered yet
# In Telegram bot DM:
/id  # Get chat ID
/main <secret>  # Claim admin
```

---

## Farm Mode Issues

### Home Assistant Not Reachable

```bash
# Check HA is running
curl http://localhost:8123

# Check token
curl -H "Authorization: Bearer $HA_TOKEN" \
  http://localhost:8123/api/states
```

### Farm Validation Fails

```bash
# Run farm doctor
npm run farm:doctor

# Re-run onboarding
./scripts/farm-onboarding.sh
```

See [FARM_ONBOARDING.md](./FARM_ONBOARDING.md) for detailed farm troubleshooting.

---

## Data and State Issues

### Corrupted SQLite Database

```bash
# Stop service first
fft service stop

# Backup corrupted db
cp store/fft_nano.db store/fft_nano.db.bak

# Check integrity
sqlite3 store/fft_nano.db "PRAGMA integrity_check;"

# If corrupted, you may need to reset:
# rm store/fft_nano.db
# fft service restart
```

### Memory Files Gone

```bash
# Check groups exist
ls groups/

# Main workspace
ls ~/nano/

# Re-seed if needed
fft onboard --force
```

---

## Permission Issues

### Service Won't Start (Permission Denied)

```bash
# Check service script permissions
ls -la scripts/service.sh

# Make executable
chmod +x scripts/service.sh

# Linux: may need sudo
sudo ./scripts/service.sh start
```

### Cannot Write to Directory

```bash
# Check ownership
ls -la ~/nano

# Fix ownership
sudo chown -R $USER ~/nano
```

---

## Log Analysis

### Where Logs Are Located

| Log | Location | Purpose |
|-----|----------|---------|
| Host logs | `logs/fft_nano.log` | Main service log |
| Error logs | `logs/fft_nano.error.log` | Error-only log |
| Container logs | `groups/<group>/logs/` | Per-group agent logs |

### Reading Logs

```bash
# View all logs
fft service logs

# Follow logs in real-time
fft service logs -f

# Search for errors
fft service logs | grep -i error

# Search for specific chat
fft service logs | grep -i "chat-id-123"
```

### Enable Debug Mode

```bash
# Add to .env:
LOG_LEVEL=debug

# Restart
fft service restart

# Now logs will be very verbose
fft service logs
```

---

## Recovery Procedures

### Complete Service Reset

```bash
# 1. Stop service
fft service stop

# 2. Backup data
npm run backup:state

# 3. Clear logs
rm -f logs/*.log

# 4. Restart
fft service start

# 5. Verify
fft doctor
```

### Factory Reset

```bash
# WARNING: This deletes all data
# 1. Uninstall service
fft service stop
fft service uninstall

# 2. Remove all data
rm -rf ~/nano
rm -rf data/
rm -rf groups/
rm -rf store/
rm -f .env

# 3. Fresh install
./scripts/onboard-all.sh
```

### Docker Factory Reset

```bash
# Remove all FFT_nano containers
docker rm -f $(docker ps -a -q --filter "name=fft-nano" 2>/dev/null)

# Remove images
docker rmi $(docker images -q --filter "reference=fft*" 2>/dev/null)

# Full Docker cleanup
docker system prune -a -f

# Restart service (will rebuild)
fft service restart
```

---

## Getting Help

If you can't resolve the issue:

### Gather Diagnostics

```bash
# Create diagnostic bundle
fft doctor --json > diagnostics.json

# Include in bug report:
# - Output of fft doctor
# - Last 100 lines of logs: fft service logs | tail -100
# - Service status: fft service status
# - .env (remove sensitive values first)
```

### Report an Issue

1. Check existing issues: [GitHub Issues](https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/issues)
2. Create new issue with:
   - FFT_nano version
   - Platform (macOS/Linux/Pi)
   - Docker version
   - Steps to reproduce
   - Relevant logs

---

## Health Check Reference

`fft doctor` checks:

| Check | What It Verifies |
|-------|-----------------|
| Docker | Docker daemon running |
| Node | Node.js version >= 20 |
| Dependencies | npm packages installed |
| Build | TypeScript compiles |
| Config | .env has required values |
| Service | Service is running |
| Network | Can reach provider API |

All checks must pass for full functionality.
