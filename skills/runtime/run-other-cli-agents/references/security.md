# Security Considerations for Running CLI Agents

This document outlines security best practices when executing external CLI agents, particularly when dealing with untrusted or third-party agents.

## Table of Contents

- [Threat Model](#threat-model)
- [Sandboxing](#sandboxing)
- [Input Validation](#input-validation)
- [Output Sanitization](#output-sanitization)
- [Resource Limits](#resource-limits)
- [Network Isolation](#network-isolation)
- [File System Access Control](#file-system-access-control)
- [Secrets Management](#secrets-management)
- [Audit Logging](#audit-logging)
- [Security Checklist](#security-checklist)

## Threat Model

### Potential Risks When Running External Agents

1. **Command Injection**: Malicious agents could inject shell commands
2. **Data Exfiltration**: Agents accessing and transmitting sensitive data
3. **Resource Exhaustion**: CPU, memory, or disk space consumption
4. **Privilege Escalation**: Agents attempting to gain higher privileges
5. **Network Attacks**: Agents making unauthorized network connections
6. **File System Manipulation**: Unauthorized reading, writing, or deletion of files
7. **Supply Chain Attacks**: Compromised dependencies or agent binaries

## Sandboxing

### Using Firejail (Linux)

The `run_agent.sh` script supports firejail sandboxing:

```bash
# Basic sandboxing
./scripts/run_agent.sh --sandbox untrusted-agent "Task"

# Firejail restricts:
# - Network access (--net=none)
# - File system access (--private)
# - Process isolation
```

### Manual Firejail Configuration

For more control, invoke firejail directly:

```bash
# No network, limited file system
firejail \
    --private \
    --net=none \
    --seccomp \
    --caps.drop=all \
    untrusted-agent "task"

# Read-only file system with specific writable directories
firejail \
    --private=/tmp/agent_sandbox \
    --read-only=/home \
    --read-write=/tmp/agent_output \
    --net=none \
    untrusted-agent "task"
```

### Docker Containers (Cross-Platform)

For stronger isolation across platforms:

```bash
# Run agent in isolated Docker container
docker run \
    --rm \
    --network=none \
    --memory=512m \
    --cpus=1 \
    --read-only \
    --tmpfs /tmp \
    -v /tmp/agent_input:/input:ro \
    -v /tmp/agent_output:/output:rw \
    agent-image \
    agent-command "task"
```

### macOS Sandbox (sandbox-exec)

```bash
# macOS built-in sandboxing
sandbox-exec -f agent.sb agent-command "task"
```

Example sandbox profile (`agent.sb`):

```scheme
(version 1)
(deny default)
(allow process-exec (literal "/path/to/agent"))
(allow file-read* (subpath "/usr"))
(allow file-write* (subpath "/tmp/agent_output"))
```

## Input Validation

### Validate Agent Paths

```bash
# Check agent is in allowed directory
ALLOWED_AGENT_DIR="/usr/local/bin/agents"

validate_agent() {
    local agent="$1"
    local agent_path
    agent_path=$(command -v "$agent")

    if [[ ! "$agent_path" =~ ^${ALLOWED_AGENT_DIR}/ ]]; then
        echo "Error: Agent must be in $ALLOWED_AGENT_DIR" >&2
        return 1
    fi

    # Check it's an actual executable, not a symlink to malicious code
    if [[ -L "$agent_path" ]]; then
        echo "Error: Agent cannot be a symbolic link" >&2
        return 1
    fi

    return 0
}
```

### Sanitize Task Input

```bash
# Remove shell metacharacters from task description
sanitize_input() {
    local input="$1"

    # Remove potentially dangerous characters
    echo "$input" | tr -d ';\|&$<>`'
}

# Usage
SAFE_TASK=$(sanitize_input "$USER_INPUT")
./scripts/run_agent.sh agent "$SAFE_TASK"
```

### Whitelist Allowed Agents

```bash
# Only allow execution of pre-approved agents
ALLOWED_AGENTS=("data-agent" "math-agent" "weather-agent")

is_agent_allowed() {
    local agent="$1"

    for allowed in "${ALLOWED_AGENTS[@]}"; do
        if [[ "$agent" == "$allowed" ]]; then
            return 0
        fi
    done

    echo "Error: Agent '$agent' is not in allowlist" >&2
    return 1
}

# Usage
if is_agent_allowed "$AGENT_NAME"; then
    ./scripts/run_agent.sh "$AGENT_NAME" "$TASK"
fi
```

## Output Sanitization

### Filter Sensitive Data from Output

```bash
# Remove common sensitive patterns
sanitize_output() {
    local output="$1"

    echo "$output" | \
        sed -E 's/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/[EMAIL]/g' | \
        sed -E 's/([0-9]{3}[-.]?[0-9]{3}[-.]?[0-9]{4})/[PHONE]/g' | \
        sed -E 's/(password|token|secret|key)[:=]\s*\S+/\1=[REDACTED]/gi'
}

# Usage
RAW_OUTPUT=$(./scripts/run_agent.sh agent "task")
CLEAN_OUTPUT=$(sanitize_output "$RAW_OUTPUT")
echo "$CLEAN_OUTPUT"
```

### Validate Output Structure

```bash
# Ensure output matches expected schema
validate_json_output() {
    local output="$1"
    local schema="$2"

    if ! echo "$output" | jq -e . >/dev/null 2>&1; then
        echo "Error: Invalid JSON output" >&2
        return 1
    fi

    # Validate against JSON schema (requires ajv-cli)
    if ! echo "$output" | ajv validate -s "$schema"; then
        echo "Error: Output doesn't match schema" >&2
        return 1
    fi

    return 0
}
```

## Resource Limits

### Limit CPU Usage

```bash
# Using cpulimit (if available)
cpulimit -l 50 -- ./scripts/run_agent.sh agent "task"

# Using nice/renice to lower priority
nice -n 19 ./scripts/run_agent.sh agent "task"

# Using systemd-run with resource limits
systemd-run \
    --user \
    --scope \
    --property=CPUQuota=50% \
    --property=MemoryLimit=512M \
    ./scripts/run_agent.sh agent "task"
```

### Limit Memory Usage

```bash
# Using ulimit
(ulimit -v 524288 && ./scripts/run_agent.sh agent "task")  # 512MB

# Using cgroups (Linux)
cgexec -g memory:agent_group ./scripts/run_agent.sh agent "task"
```

### Limit Disk Usage

```bash
# Create temporary directory with size limit (Linux)
mkdir /tmp/agent_workspace
mount -t tmpfs -o size=100M tmpfs /tmp/agent_workspace

# Run agent with workspace
cd /tmp/agent_workspace
./scripts/run_agent.sh agent "task"
```

### Comprehensive Resource Limiting

```bash
# Wrapper script with multiple limits
run_agent_limited() {
    local agent="$1"
    local task="$2"

    # Set limits before execution
    ulimit -t 60      # Max 60 seconds CPU time
    ulimit -v 524288  # Max 512MB virtual memory
    ulimit -f 10240   # Max 10MB output file size
    ulimit -n 64      # Max 64 open files

    # Execute with timeout
    timeout 120s ./scripts/run_agent.sh \
        --timeout 90 \
        "$agent" \
        "$task"
}
```

## Network Isolation

### Disable Network Access

```bash
# Using firejail
firejail --net=none ./scripts/run_agent.sh agent "task"

# Using unshare (Linux)
unshare --net ./scripts/run_agent.sh agent "task"

# Using Docker
docker run --network=none agent-image agent-command "task"
```

### Allow Only Specific Hosts

```bash
# Using iptables to whitelist specific hosts
# (requires root, set up beforehand)

# Block all outbound
iptables -A OUTPUT -j DROP

# Allow specific hosts
iptables -I OUTPUT -d api.trusted-service.com -j ACCEPT
iptables -I OUTPUT -d 8.8.8.8 -j ACCEPT

# Run agent
./scripts/run_agent.sh agent "task"

# Clean up rules
iptables -D OUTPUT -d api.trusted-service.com -j ACCEPT
iptables -D OUTPUT -d 8.8.8.8 -j ACCEPT
iptables -D OUTPUT -j DROP
```

### Monitor Network Activity

```bash
# Log network connections made by agent
strace -f -e trace=network ./scripts/run_agent.sh agent "task" 2>&1 | \
    grep -E 'connect|sendto|recvfrom'
```

## File System Access Control

### Restrict File Access

```bash
# Run agent with limited file system view
unshare --mount --map-root-user bash <<'EOF'
mount --bind /tmp/agent_data /data
mount -o remount,ro /usr
mount -o remount,ro /etc
./scripts/run_agent.sh agent "task"
EOF
```

### Use Temporary Directories

```bash
# Create isolated workspace
WORKSPACE=$(mktemp -d)
cd "$WORKSPACE"

# Copy only necessary files
cp /path/to/input.txt .

# Run agent
./scripts/run_agent.sh agent "Process input.txt"

# Cleanup
cd /
rm -rf "$WORKSPACE"
```

### Monitor File Access

```bash
# Track files accessed by agent (Linux)
strace -f -e trace=file ./scripts/run_agent.sh agent "task" 2>&1 | \
    grep -E 'open|openat|read|write'

# Using inotify to monitor specific directories
inotifywait -m -r /sensitive/directory &
INOTIFY_PID=$!

./scripts/run_agent.sh agent "task"

kill $INOTIFY_PID
```

## Secrets Management

### Never Pass Secrets Directly

```bash
# BAD: Passing secret in command
./scripts/run_agent.sh agent "Use API key abc123xyz"

# GOOD: Use environment variable
export API_KEY="abc123xyz"
./scripts/run_agent.sh agent "Use configured API key"
unset API_KEY

# BETTER: Use secrets manager
API_KEY=$(vault kv get -field=key secret/api)
export API_KEY
./scripts/run_agent.sh agent "Use configured API key"
unset API_KEY
```

### Limit Secret Scope

```bash
# Run agent in subprocess with isolated environment
(
    export TEMP_SECRET="secret_value"
    ./scripts/run_agent.sh agent "task"
)
# TEMP_SECRET not accessible outside subshell
```

### Mask Secrets in Logs

```bash
# Configure logging to redact secrets
log_safe() {
    echo "$@" | sed -E 's/(password|token|key|secret)[:=]\s*\S+/\1=[REDACTED]/gi' >&2
}

# Use for all logging
log_safe "Connecting with token: abc123"
# Output: Connecting with token: [REDACTED]
```

## Audit Logging

### Comprehensive Logging

```bash
# Enhanced run_agent.sh wrapper with audit logging
AUDIT_LOG="/var/log/agent_audit.log"

audit_log() {
    local level="$1"
    shift
    echo "$(date -Iseconds) [$level] $*" >> "$AUDIT_LOG"
}

run_with_audit() {
    local agent="$1"
    local task="$2"

    audit_log "INFO" "Starting agent: $agent"
    audit_log "INFO" "Task: $task"
    audit_log "INFO" "User: $(whoami)"
    audit_log "INFO" "PID: $$"

    if ./scripts/run_agent.sh "$agent" "$task"; then
        audit_log "SUCCESS" "Agent completed: $agent"
    else
        audit_log "ERROR" "Agent failed: $agent (exit code: $?)"
    fi
}
```

### Log Rotation

```bash
# Simple log rotation
AUDIT_LOG="/var/log/agent_audit.log"
MAX_SIZE=$((10 * 1024 * 1024))  # 10MB

if [ -f "$AUDIT_LOG" ] && [ $(stat -f%z "$AUDIT_LOG") -gt $MAX_SIZE ]; then
    mv "$AUDIT_LOG" "${AUDIT_LOG}.$(date +%Y%m%d%H%M%S)"
    gzip "${AUDIT_LOG}.*" 2>/dev/null || true
fi
```

## Security Checklist

Use this checklist when running external CLI agents:

### Before Execution

- [ ] Verify agent source and integrity (checksum, signature)
- [ ] Validate agent is in allowed directory
- [ ] Check agent permissions (not world-writable)
- [ ] Sanitize all input parameters
- [ ] Configure appropriate timeout
- [ ] Set resource limits (CPU, memory, disk)
- [ ] Enable sandboxing for untrusted agents
- [ ] Isolate network access if not needed
- [ ] Prepare isolated workspace directory
- [ ] Configure audit logging

### During Execution

- [ ] Monitor resource usage
- [ ] Watch for suspicious network activity
- [ ] Track file system access
- [ ] Capture complete logs
- [ ] Handle errors gracefully

### After Execution

- [ ] Validate output format and content
- [ ] Sanitize output before use
- [ ] Check for sensitive data leakage
- [ ] Review audit logs
- [ ] Clean up temporary files
- [ ] Verify workspace isolation
- [ ] Report anomalies or security events

## Example Secure Agent Invocation

Putting it all together:

```bash
#!/bin/bash

secure_agent_run() {
    local agent="$1"
    local task="$2"

    # Validation
    if ! is_agent_allowed "$agent"; then
        echo "Agent not allowed" >&2
        return 1
    fi

    # Sanitization
    local safe_task
    safe_task=$(sanitize_input "$task")

    # Prepare workspace
    local workspace
    workspace=$(mktemp -d)
    trap "rm -rf $workspace" EXIT

    # Resource limits
    ulimit -t 60
    ulimit -v 524288
    ulimit -f 10240

    # Audit log
    audit_log "INFO" "Running $agent with task: $safe_task"

    # Execute with all protections
    (
        cd "$workspace"
        timeout 90s \
            firejail \
                --private="$workspace" \
                --net=none \
                --seccomp \
                --caps.drop=all \
            ./scripts/run_agent.sh \
                --timeout 60 \
                --format json \
                --quiet \
                "$agent" \
                "$safe_task"
    )

    local exit_code=$?

    # Validate output
    if [ $exit_code -eq 0 ]; then
        audit_log "SUCCESS" "Agent completed successfully"
    else
        audit_log "ERROR" "Agent failed with code $exit_code"
    fi

    return $exit_code
}
```

## Additional Resources

- [OWASP Command Injection](https://owasp.org/www-community/attacks/Command_Injection)
- [Firejail Documentation](https://firejail.wordpress.com/)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Linux Capabilities](https://man7.org/linux/man-pages/man7/capabilities.7.html)
- [Seccomp BPF Filter](https://www.kernel.org/doc/html/latest/userspace-api/seccomp_filter.html)
