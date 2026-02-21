---
name: run-other-cli-agents
description: "Execute and orchestrate external CLI-based agents to delegate subtasks, obtain specialized outputs, or compose multi-agent workflows. Use this skill when: (1) A task requires capabilities from specialized external agents (math, weather, data processing, API clients, etc.), (2) You need to parallelize work across multiple agent instances, (3) Building multi-stage pipelines where different agents handle different processing stages, (4) Delegating to domain-specific agents for better results, (5) Running untrusted third-party agents safely with sandboxing, or (6) Orchestrating async/background agent execution for long-running tasks. Requires bash tool access and target CLI agents available in PATH."
---

# Run Other CLI Agents

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

Execute external CLI agents safely with comprehensive error handling, async execution, output format detection, and security controls.

## Core Capabilities

- **Safe Execution**: Built-in error handling, retries, and timeout management
- **Async Mode**: Run agents in background for long-running tasks
- **Format Detection**: Auto-detect and validate JSON, XML, or text output
- **Sandboxing**: Execute untrusted agents with filesystem and network isolation
- **Agent Chaining**: Pipe output from one agent to another
- **Parallel Execution**: Run multiple agents simultaneously
- **Resource Management**: Control CPU, memory, and timeout limits
- **Audit Logging**: Track all agent invocations and results

## Quick Start

### Basic Invocation

```bash
./scripts/run_agent.sh math-agent "Calculate sqrt(144)"
```

### With Advanced Features

```bash
# Async execution with retry and JSON output
./scripts/run_agent.sh --async --retry 3 --format json api-agent "GET /users"

# Sandboxed untrusted agent
./scripts/run_agent.sh --sandbox --timeout 30 third-party-agent "Process data"
```

## Using the Helper Script

The `scripts/run_agent.sh` script provides robust agent execution with multiple options:

### Command Syntax

```bash
./scripts/run_agent.sh [OPTIONS] <agent_command> "task description" [agent_args...]
```

### Common Options

- `--async` - Run agent in background, return immediately with run ID
- `--timeout N` - Set timeout in seconds (default: 300)
- `--retry N` - Retry N times on failure (default: 0)
- `--format FMT` - Expected output format: json|text|auto (default: auto)
- `--sandbox` - Run in restricted sandbox (requires firejail)
- `--quiet` - Suppress informational output
- `--help` - Show full help message

### Environment Variables

- `AGENT_LOG_DIR` - Log directory (default: /tmp/agent_logs)
- `AGENT_TIMEOUT` - Default timeout in seconds
- `MAX_RETRIES` - Default retry count
- `RETRY_DELAY` - Delay between retries in seconds

## Common Patterns

### Agent Chaining

Connect multiple agents in a pipeline:

```bash
# Extract → Transform → Load
raw=$(./scripts/run_agent.sh extractor "Extract from source")
transformed=$(./scripts/run_agent.sh transformer "$raw")
./scripts/run_agent.sh loader "$transformed"
```

### Parallel Execution

Run multiple agents simultaneously:

```bash
./scripts/run_agent.sh agent1 "Task 1" &
./scripts/run_agent.sh agent2 "Task 2" &
./scripts/run_agent.sh agent3 "Task 3" &
wait
```

### Async with Status Checking

Launch long-running agents in background:

```bash
# Start async
RUN_ID=$(./scripts/run_agent.sh --async data-processor "Process large_dataset.csv")

# Check status
PID=$(cat /tmp/agent_logs/${RUN_ID}.pid)
kill -0 $PID 2>/dev/null && echo "Running" || echo "Done"

# Get results
cat /tmp/agent_logs/${RUN_ID}.out
```

### Error Recovery

Handle failures with retries:

```bash
./scripts/run_agent.sh --retry 3 --timeout 60 flaky-agent "Task"
```

### Format Validation

Ensure output is valid JSON:

```bash
./scripts/run_agent.sh --format json api-agent "GET /data" | jq '.results'
```

## Security Considerations

When running untrusted or third-party agents, always use security controls. See `references/security.md` for comprehensive security guidance including:

- Sandboxing with firejail, Docker, or platform-specific tools
- Input validation and sanitization
- Output sanitization for sensitive data
- Resource limits (CPU, memory, disk, network)
- File system access control
- Secrets management
- Audit logging

### Quick Security Example

```bash
# Run untrusted agent with multiple protections
./scripts/run_agent.sh \
    --sandbox \
    --timeout 30 \
    --format json \
    --quiet \
    untrusted-agent "task"
```

## Advanced Usage

### Multi-Stage Pipeline with Checkpoints

Build resilient pipelines that can resume after failures:

```bash
# Stage 1
if [ ! -f .stage1_done ]; then
    ./scripts/run_agent.sh --retry 3 stage1-agent "Extract" && touch .stage1_done
fi

# Stage 2
if [ ! -f .stage2_done ]; then
    ./scripts/run_agent.sh --retry 3 stage2-agent "Transform" && touch .stage2_done
fi

# Stage 3
./scripts/run_agent.sh --retry 3 stage3-agent "Load"
```

### Load Balancing

Distribute tasks across agent pool:

```bash
AGENTS=("agent-1" "agent-2" "agent-3")
TASKS=("task1" "task2" "task3" "task4" "task5")

i=0
for task in "${TASKS[@]}"; do
    agent="${AGENTS[$((i % ${#AGENTS[@]}))]}"
    ./scripts/run_agent.sh --async "$agent" "$task"
    i=$((i + 1))
done
wait
```

### Conditional Agent Selection

Route to specialized agents based on input:

```bash
case "$REQUEST_TYPE" in
    "weather")
        ./scripts/run_agent.sh weather-agent "$REQUEST_DATA"
        ;;
    "stocks")
        ./scripts/run_agent.sh --format json stock-agent "$REQUEST_DATA"
        ;;
    "news")
        ./scripts/run_agent.sh news-agent "$REQUEST_DATA"
        ;;
esac
```

## Reference Documentation

For detailed examples and security guidance, see:

- **`references/examples.md`** - Comprehensive usage examples including:
  - Basic and advanced invocations
  - Async and background execution patterns
  - Error handling and retry strategies
  - Output format detection and validation
  - Agent chaining and pipeline patterns
  - Parallel execution with xargs and background jobs
  - Real-world scenarios (web scraping, ML workflows, ETL pipelines)
  - Monitoring and alerting patterns

- **`references/security.md`** - Security best practices including:
  - Threat model and risk assessment
  - Sandboxing with firejail, Docker, macOS sandbox
  - Input validation and sanitization
  - Output sanitization for sensitive data
  - Resource limits (CPU, memory, disk, network)
  - Network isolation techniques
  - File system access control
  - Secrets management
  - Audit logging
  - Complete security checklist

## Troubleshooting

### Agent Not Found

```bash
# Check if agent is in PATH
command -v agent-name

# List available agents
compgen -c | grep -E 'agent|cli'
```

### Timeout Issues

```bash
# Increase timeout
./scripts/run_agent.sh --timeout 600 slow-agent "task"

# Or set environment variable
AGENT_TIMEOUT=600 ./scripts/run_agent.sh slow-agent "task"
```

### Output Format Problems

```bash
# Let script detect format
./scripts/run_agent.sh --format auto agent "task"

# Or specify expected format
./scripts/run_agent.sh --format json agent "task"
```

### Permission Errors

```bash
# Ensure script is executable
chmod +x scripts/run_agent.sh

# Check log directory permissions
mkdir -p /tmp/agent_logs
chmod 755 /tmp/agent_logs
```

## Best Practices

1. **Always use timeouts** - Prevent runaway agents with `--timeout`
2. **Validate output** - Use `--format` to ensure expected output structure
3. **Handle errors** - Use `--retry` for network-dependent agents
4. **Isolate untrusted code** - Always use `--sandbox` for third-party agents
5. **Log everything** - Review logs in `$AGENT_LOG_DIR` for debugging
6. **Clean up** - Remove old logs periodically to save disk space
7. **Test in isolation** - Run new agents standalone before chaining
8. **Use quiet mode in scripts** - Add `--quiet` to reduce log noise
9. **Monitor resources** - Check CPU/memory usage for long-running agents
10. **Version control agents** - Track which agent versions are deployed

## Integration Examples

### With CI/CD Pipeline

```bash
# .github/workflows/agent-tests.yml
- name: Test agents
  run: |
    ./scripts/run_agent.sh --timeout 30 test-agent "Run tests"
```

### With Cron Jobs

```bash
# Hourly monitoring
0 * * * * /path/to/run_agent.sh monitor-agent "Check system health"
```

### With Systemd Services

```ini
[Unit]
Description=Background Agent Processor

[Service]
ExecStart=/path/to/run_agent.sh --async processor-agent "Process queue"
Restart=always

[Install]
WantedBy=multi-user.target
```

## Performance Tips

- Use `--async` for long-running agents to avoid blocking
- Run independent agents in parallel with `&` and `wait`
- Set appropriate timeouts to free resources quickly
- Use `--quiet` in scripts to reduce I/O overhead
- Clean up old logs in `$AGENT_LOG_DIR` regularly
- Consider agent pooling for high-frequency invocations
- Use `--format json` when output needs parsing (faster than regex)

## Direct Invocation (Alternative)

If you don't need the wrapper's features, invoke agents directly:

```bash
agent-name "task description" [args...]
```

However, the wrapper script provides significant benefits:
- Automatic error handling and logging
- Timeout and retry capabilities
- Format detection and validation
- Security controls
- Consistent interface across all agents
