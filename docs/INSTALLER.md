# FFT_nano Installer

## Canonical URL

The public installer script is served directly from the GitHub repository:

```
https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/main/scripts/install.sh
```

This URL is **canonical** — it always serves the current `main` branch. Cutting a new
GitHub release tag is sufficient for the installer to serve the new version; no
manual upload step is required.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/main/scripts/install.sh | bash
```

The installer downloads the latest stable release, installs missing system basics
where it can, chooses Docker when it is already healthy, falls back to host runtime
when Docker is unavailable, then runs the guided onboarding.

## Runtime Selection

Override the runtime at install time:

```bash
# isolated Docker runtime
curl -fsSL https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/main/scripts/install.sh | bash -s -- --runtime docker

# host runtime fallback
curl -fsSL https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/main/scripts/install.sh | bash -s -- --runtime host
```

## Environment Overrides

| Variable | Default | Description |
|---|---|---|
| `FFT_NANO_REF` | `latest` | Release tag to install. Use `v1.7.2` for a specific version, `main` for the current public branch, or `latest` (default) to resolve the most recent tagged release via GitHub releases redirect. |
| `FFT_NANO_REPO` | `0-CYBERDYNE-SYSTEMS-0/FFT_nano` | GitHub repo in `owner/repo` form. Change to install from a fork. |
| `FFT_NANO_INSTALL_DIR` | `~/FFT_nano` | Target installation directory. |
| `FFT_NANO_FORCE` | `0` | Set to `1` to replace a non-empty installation directory. |
| `FFT_NANO_AUTO_LINK` | `1` | Set to `0` to skip the pinned `~/.local/bin/fft` launcher and global `npm link`. |
| `FFT_NANO_USER_BIN_DIR` | `~/.local/bin` | Install the pinned `fft` launcher to a custom directory. |

Examples:

```bash
# Install a specific version
FFT_NANO_REF=v1.7.2 curl -fsSL https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/main/scripts/install.sh | bash

# Install from a fork
FFT_NANO_REPO=myuser/FFT_nano curl -fsSL https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/main/scripts/install.sh | bash

# Install to a custom directory
FFT_NANO_INSTALL_DIR=/opt/fft curl -fsSL https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/main/scripts/install.sh | bash
```

## Upgrading

After a fresh install, upgrade by pulling the latest changes and rebuilding:

```bash
cd ~/FFT_nano
git pull --ff-only
./scripts/setup.sh --runtime docker
./scripts/service.sh restart
```

Or use the `fft update` command from Telegram, Web Control Center, TUI, or CLI
for a guided update with live progress feedback.
