# FFT_nano (FarmFriendTerminal_nano)

Secure, containerized assistant foundation. This fork is being evolved into an agricultural assistant for farmers of all sizes.

## Quick Context

Single Node.js process that connects to chat channels, routes messages to the agent runner inside an isolated Linux container (Apple Container on macOS, Docker on Linux). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: channel connection(s), message routing, IPC |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container (Apple Container)
./container/build-docker.sh # Rebuild agent container (Docker)
```

Service management (macOS):
```bash
launchctl load ~/Library/LaunchAgents/com.fft_nano.plist
launchctl unload ~/Library/LaunchAgents/com.fft_nano.plist
```
