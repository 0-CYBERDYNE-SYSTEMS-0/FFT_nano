# Agent Invocation Examples

This document provides comprehensive examples of using the `run_agent.sh` script for various agent orchestration scenarios.

## Table of Contents

- [Basic Invocations](#basic-invocations)
- [Async and Background Execution](#async-and-background-execution)
- [Error Handling and Retries](#error-handling-and-retries)
- [Output Format Detection](#output-format-detection)
- [Agent Chaining](#agent-chaining)
- [Parallel Execution](#parallel-execution)
- [Timeout Management](#timeout-management)
- [Sandbox Mode](#sandbox-mode)
- [Real-World Scenarios](#real-world-scenarios)

## Basic Invocations

### Simple Query

```bash
./scripts/run_agent.sh math-agent "Calculate the square root of 144"
```

### With Additional Arguments

```bash
./scripts/run_agent.sh code-agent "Write a Python function to sort a list" --style pep8 --output suggestions.py
```

### Weather Lookup

```bash
./scripts/run_agent.sh weather-cli "Current temperature in Berlin, Germany"
```

### Data Processing

```bash
./scripts/run_agent.sh data-agent "Analyze sales trends in Q4 data"
```

## Async and Background Execution

### Run Agent in Background

```bash
# Start agent asynchronously
RUN_ID=$(./scripts/run_agent.sh --async data-processor "Process large_dataset.csv")

echo "Agent running with ID: $RUN_ID"

# Check if still running
PID=$(cat /tmp/agent_logs/${RUN_ID}.pid)
kill -0 $PID 2>/dev/null && echo "Still running" || echo "Completed"

# Retrieve output when done
cat /tmp/agent_logs/${RUN_ID}.out
```

### Multiple Async Agents

```bash
# Start multiple agents in parallel
ID1=$(./scripts/run_agent.sh --async agent1 "Task 1")
ID2=$(./scripts/run_agent.sh --async agent2 "Task 2")
ID3=$(./scripts/run_agent.sh --async agent3 "Task 3")

# Wait for all to complete
for id in $ID1 $ID2 $ID3; do
    PID=$(cat /tmp/agent_logs/${id}.pid)
    while kill -0 $PID 2>/dev/null; do
        sleep 1
    done
    echo "Agent $id completed"
done

# Collect results
cat /tmp/agent_logs/${ID1}.out
cat /tmp/agent_logs/${ID2}.out
cat /tmp/agent_logs/${ID3}.out
```

## Error Handling and Retries

### Retry on Failure

```bash
# Retry up to 3 times with 5-second delay
./scripts/run_agent.sh --retry 3 unreliable-agent "Fetch data from API"

# Or use environment variable
RETRY_DELAY=5 ./scripts/run_agent.sh --retry 3 unreliable-agent "Task"
```

### Custom Error Handling

```bash
# Capture exit code
if ! ./scripts/run_agent.sh flaky-agent "Task"; then
    echo "Agent failed, trying fallback method"
    ./scripts/run_agent.sh backup-agent "Same task"
fi
```

### Conditional Retry Logic

```bash
max_attempts=5
attempt=0
success=false

while [ $attempt -lt $max_attempts ] && [ "$success" = false ]; do
    attempt=$((attempt + 1))
    echo "Attempt $attempt of $max_attempts"

    if ./scripts/run_agent.sh api-agent "GET /data"; then
        success=true
    else
        echo "Failed, waiting before retry..."
        sleep $((attempt * 2))  # Exponential backoff
    fi
done
```

## Output Format Detection

### Auto-Detect Format

```bash
# Automatically detects JSON, XML, text, etc.
OUTPUT=$(./scripts/run_agent.sh api-agent "GET /users/123")

# Check detected format from logs
./scripts/run_agent.sh --format auto api-agent "GET /users/123"
```

### Expect JSON Output

```bash
# Validates output is valid JSON
./scripts/run_agent.sh --format json api-agent "GET /users" | jq '.users[0].name'
```

### Process Different Formats

```bash
# JSON output
json_data=$(./scripts/run_agent.sh --format json api-agent "GET /data")
echo "$json_data" | jq '.results[] | .name'

# Text output
text_output=$(./scripts/run_agent.sh --format text summarizer-agent "Summarize this article")
echo "$text_output" | wc -l

# XML output
xml_data=$(./scripts/run_agent.sh --format xml xml-agent "Generate config")
echo "$xml_data" | xmllint --format -
```

## Agent Chaining

### Sequential Pipeline

```bash
# Extract, transform, load pattern
raw_data=$(./scripts/run_agent.sh extractor-agent "Extract tables from report.pdf")
transformed=$(./scripts/run_agent.sh transformer-agent "$raw_data")
./scripts/run_agent.sh loader-agent "$transformed"
```

### Conditional Chaining

```bash
# Run different agents based on output
classification=$(./scripts/run_agent.sh classifier-agent "Analyze this text: $TEXT")

if echo "$classification" | grep -q "sentiment: positive"; then
    ./scripts/run_agent.sh positive-handler-agent "$TEXT"
else
    ./scripts/run_agent.sh negative-handler-agent "$TEXT"
fi
```

### Multi-Stage Processing

```bash
# Stage 1: Data collection
data=$(./scripts/run_agent.sh collector-agent "Gather metrics for last 7 days")

# Stage 2: Analysis
analysis=$(./scripts/run_agent.sh analyzer-agent "$data")

# Stage 3: Visualization
./scripts/run_agent.sh viz-agent "$analysis" --output report.png

# Stage 4: Notification
./scripts/run_agent.sh notifier-agent "Report generated" --attach report.png
```

## Parallel Execution

### Simple Parallel Pattern

```bash
# Start multiple agents and wait for all
./scripts/run_agent.sh agent1 "Task 1" &
./scripts/run_agent.sh agent2 "Task 2" &
./scripts/run_agent.sh agent3 "Task 3" &

# Wait for all background jobs
wait

echo "All agents completed"
```

### Parallel with Result Collection

```bash
# Run agents in parallel, collect outputs
{
    ./scripts/run_agent.sh agent1 "Task 1" > /tmp/out1.txt
} &
{
    ./scripts/run_agent.sh agent2 "Task 2" > /tmp/out2.txt
} &
{
    ./scripts/run_agent.sh agent3 "Task 3" > /tmp/out3.txt
} &

wait

# Combine results
cat /tmp/out1.txt /tmp/out2.txt /tmp/out3.txt > combined_results.txt
```

### Parallel Processing with xargs

```bash
# Process multiple items in parallel
echo -e "task1\ntask2\ntask3\ntask4" | \
    xargs -P 4 -I {} ./scripts/run_agent.sh processor-agent "Process {}"
```

### Map-Reduce Pattern

```bash
# Map phase: parallel processing
for file in data/*.csv; do
    ./scripts/run_agent.sh --async mapper-agent "Process $file"
done

# Wait for all mappers to complete
sleep 5

# Reduce phase: aggregate results
./scripts/run_agent.sh reducer-agent "Aggregate all results from /tmp/agent_logs/"
```

## Timeout Management

### Set Custom Timeout

```bash
# 30-second timeout
./scripts/run_agent.sh --timeout 30 slow-agent "Long-running task"
```

### Handle Timeout Gracefully

```bash
if ./scripts/run_agent.sh --timeout 60 agent "Task" 2>&1 | grep -q "timed out"; then
    echo "Agent timed out, using cached result"
    cat cached_result.txt
fi
```

### Progressive Timeout

```bash
# Try with increasing timeouts
for timeout in 10 30 60 120; do
    echo "Trying with ${timeout}s timeout..."
    if ./scripts/run_agent.sh --timeout $timeout agent "Task"; then
        echo "Succeeded with ${timeout}s timeout"
        break
    fi
done
```

## Sandbox Mode

### Run Untrusted Agent Safely

```bash
# Requires firejail installed
./scripts/run_agent.sh --sandbox untrusted-agent "Perform task"
```

### Sandbox with Timeout and Retry

```bash
# Defense in depth: sandbox + timeout + retry
./scripts/run_agent.sh \
    --sandbox \
    --timeout 30 \
    --retry 2 \
    third-party-agent "Process data"
```

## Real-World Scenarios

### Web Scraping Pipeline

```bash
# Scrape multiple pages in parallel
for url in "${urls[@]}"; do
    ./scripts/run_agent.sh --async scraper-agent "Scrape $url" &
done
wait

# Parse and extract data
./scripts/run_agent.sh parser-agent "Parse all scraped HTML from /tmp/agent_logs/"

# Generate report
./scripts/run_agent.sh reporter-agent "Generate scraping report"
```

### Multi-Model AI Workflow

```bash
# Get responses from multiple AI models in parallel
./scripts/run_agent.sh --async --format json gpt4-agent "Analyze this code" > gpt4_out.json &
./scripts/run_agent.sh --async --format json claude-agent "Analyze this code" > claude_out.json &
./scripts/run_agent.sh --async --format json gemini-agent "Analyze this code" > gemini_out.json &

wait

# Aggregate and compare responses
./scripts/run_agent.sh aggregator-agent "Compare $(cat gpt4_out.json claude_out.json gemini_out.json)"
```

### Data Pipeline with Error Recovery

```bash
#!/bin/bash

pipeline() {
    local checkpoint="$1"

    # Stage 1: Extract
    if [ ! -f "${checkpoint}_extract.done" ]; then
        if ./scripts/run_agent.sh --retry 3 extractor "Extract from source"; then
            touch "${checkpoint}_extract.done"
        else
            echo "Extraction failed after retries"
            return 1
        fi
    fi

    # Stage 2: Transform
    if [ ! -f "${checkpoint}_transform.done" ]; then
        if ./scripts/run_agent.sh --retry 3 transformer "Transform data"; then
            touch "${checkpoint}_transform.done"
        else
            echo "Transformation failed after retries"
            return 1
        fi
    fi

    # Stage 3: Load
    if [ ! -f "${checkpoint}_load.done" ]; then
        if ./scripts/run_agent.sh --retry 3 loader "Load to destination"; then
            touch "${checkpoint}_load.done"
        else
            echo "Loading failed after retries"
            return 1
        fi
    fi

    echo "Pipeline completed successfully"
}

pipeline "run_$(date +%Y%m%d)"
```

### Monitoring and Alerting

```bash
# Continuous monitoring with agent
while true; do
    status=$(./scripts/run_agent.sh --timeout 10 health-checker "Check system health")

    if echo "$status" | grep -q "ERROR"; then
        ./scripts/run_agent.sh alerter "ALERT: System health check failed"

        # Run diagnostic agent
        diagnostics=$(./scripts/run_agent.sh diagnostics-agent "Full system diagnostics")
        ./scripts/run_agent.sh alerter "Diagnostics: $diagnostics"
    fi

    sleep 60
done
```

### API Gateway Pattern

```bash
# Route requests to appropriate specialized agents based on input
route_request() {
    local request_type="$1"
    local request_data="$2"

    case "$request_type" in
        "weather")
            ./scripts/run_agent.sh weather-agent "$request_data"
            ;;
        "stocks")
            ./scripts/run_agent.sh --format json stock-agent "$request_data"
            ;;
        "news")
            ./scripts/run_agent.sh news-agent "$request_data"
            ;;
        *)
            echo "Unknown request type: $request_type" >&2
            return 1
            ;;
    esac
}

# Example usage
route_request "weather" "Temperature in NYC"
route_request "stocks" "AAPL current price"
```

### Load Balancing Across Agent Instances

```bash
# Distribute tasks across multiple agent instances
AGENT_POOL=("agent-instance-1" "agent-instance-2" "agent-instance-3")
TASK_QUEUE=("task1" "task2" "task3" "task4" "task5" "task6")

task_index=0
for task in "${TASK_QUEUE[@]}"; do
    agent_index=$((task_index % ${#AGENT_POOL[@]}))
    agent="${AGENT_POOL[$agent_index]}"

    echo "Assigning '$task' to $agent"
    ./scripts/run_agent.sh --async "$agent" "$task" &

    task_index=$((task_index + 1))
done

wait
echo "All tasks completed"
```

## Notes

- Always check agent exit codes for proper error handling
- Use `--quiet` flag in scripts to suppress informational output
- Set `AGENT_LOG_DIR` environment variable to customize log location
- Review logs in `/tmp/agent_logs/` for debugging
- Use `--format json` when you need to parse structured output
- Consider sandbox mode for untrusted or third-party agents
