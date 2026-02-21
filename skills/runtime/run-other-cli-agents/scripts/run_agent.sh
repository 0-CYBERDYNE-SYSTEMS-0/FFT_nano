#!/usr/bin/env bash

# Enhanced CLI Agent Runner
# Safely runs external CLI agents with error handling, format detection, and async support
# Usage: ./run_agent.sh [OPTIONS] <agent_command> "task description" [agent_args...]

set -euo pipefail

# Configuration
AGENT_LOG_DIR="${AGENT_LOG_DIR:-/tmp/agent_logs}"
AGENT_TIMEOUT="${AGENT_TIMEOUT:-300}"
MAX_RETRIES="${MAX_RETRIES:-0}"
RETRY_DELAY="${RETRY_DELAY:-2}"

# Create log directory
mkdir -p "$AGENT_LOG_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

# Usage information
usage() {
    cat >&2 <<EOF
Usage: $0 [OPTIONS] <agent_command> "task description" [agent_args...]

OPTIONS:
    -a, --async         Run agent in background and return immediately
    -t, --timeout SECS  Set timeout in seconds (default: ${AGENT_TIMEOUT})
    -r, --retry N       Retry N times on failure (default: ${MAX_RETRIES})
    -f, --format FMT    Expected output format: json|text|auto (default: auto)
    -s, --sandbox       Run agent in restricted sandbox mode (requires firejail)
    -q, --quiet         Suppress informational output
    -h, --help          Show this help message

EXAMPLES:
    # Basic invocation
    $0 math-agent "Calculate sqrt(144)"

    # Run in background
    $0 --async data-agent "Process large dataset.csv"

    # With timeout and retry
    $0 --timeout 60 --retry 3 weather-cli "Current temperature"

    # Expect JSON output
    $0 --format json api-agent "GET /users/123"

    # Sandboxed execution
    $0 --sandbox untrusted-agent "Perform task"

ENVIRONMENT:
    AGENT_LOG_DIR       Directory for agent logs (default: /tmp/agent_logs)
    AGENT_TIMEOUT       Default timeout in seconds (default: 300)
    MAX_RETRIES         Default retry count (default: 0)
    RETRY_DELAY         Delay between retries in seconds (default: 2)
EOF
    exit 1
}

# Parse options
ASYNC_MODE=false
TIMEOUT="$AGENT_TIMEOUT"
RETRIES="$MAX_RETRIES"
OUTPUT_FORMAT="auto"
SANDBOX_MODE=false
QUIET_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -a|--async)
            ASYNC_MODE=true
            shift
            ;;
        -t|--timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        -r|--retry)
            RETRIES="$2"
            shift 2
            ;;
        -f|--format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        -s|--sandbox)
            SANDBOX_MODE=true
            shift
            ;;
        -q|--quiet)
            QUIET_MODE=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        -*)
            log_error "Unknown option: $1"
            usage
            ;;
        *)
            break
            ;;
    esac
done

# Check required arguments
if [ $# -lt 2 ]; then
    log_error "Insufficient arguments"
    usage
fi

AGENT="$1"
TASK="$2"
shift 2
AGENT_ARGS=("$@")

# Generate unique run ID
RUN_ID="$(date +%s)_$$_$(echo "$AGENT" | tr '/' '_')"
LOG_FILE="$AGENT_LOG_DIR/${RUN_ID}.log"
ERROR_FILE="$AGENT_LOG_DIR/${RUN_ID}.err"
OUTPUT_FILE="$AGENT_LOG_DIR/${RUN_ID}.out"
PID_FILE="$AGENT_LOG_DIR/${RUN_ID}.pid"

# Logging functions for run
[[ "$QUIET_MODE" == false ]] && log_info "Agent: $AGENT"
[[ "$QUIET_MODE" == false ]] && log_info "Task: $TASK"
[[ "$QUIET_MODE" == false ]] && log_info "Run ID: $RUN_ID"

# Check if agent exists
if ! command -v "$AGENT" &> /dev/null; then
    log_error "Agent '$AGENT' not found in PATH"
    log_error "Available agents: $(compgen -c | grep -E 'agent|cli' | head -10 | tr '\n' ' ')"
    exit 127
fi

# Detect output format
detect_format() {
    local content="$1"

    # Try to parse as JSON
    if echo "$content" | jq . &>/dev/null; then
        echo "json"
    elif echo "$content" | grep -qE '^<[^>]+>.*</[^>]+>$'; then
        echo "xml"
    elif echo "$content" | grep -qE '^[A-Za-z0-9+/]+=*$'; then
        echo "base64"
    else
        echo "text"
    fi
}

# Validate output format
validate_output() {
    local content="$1"
    local expected_format="$2"

    if [[ "$expected_format" == "auto" ]]; then
        detect_format "$content"
        return 0
    fi

    case "$expected_format" in
        json)
            if echo "$content" | jq . &>/dev/null; then
                return 0
            else
                log_error "Expected JSON output but got invalid JSON"
                return 1
            fi
            ;;
        xml)
            # Basic XML validation
            if echo "$content" | grep -qE '^<[^>]+>.*</[^>]+>$'; then
                return 0
            else
                log_error "Expected XML output but got invalid XML"
                return 1
            fi
            ;;
        text)
            return 0
            ;;
        *)
            log_warn "Unknown format: $expected_format, treating as text"
            return 0
            ;;
    esac
}

# Build command
build_command() {
    if [[ "$SANDBOX_MODE" == true ]]; then
        if ! command -v firejail &> /dev/null; then
            log_error "Sandbox mode requires 'firejail' but it's not installed"
            exit 1
        fi
        echo "firejail --quiet --private --net=none --"
    fi
    echo ""
}

# Execute agent with retry logic
execute_agent() {
    local attempt=0
    local max_attempts=$((RETRIES + 1))

    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))

        if [ $attempt -gt 1 ]; then
            [[ "$QUIET_MODE" == false ]] && log_warn "Retry attempt $attempt of $max_attempts"
            sleep "$RETRY_DELAY"
        fi

        # Build full command
        local sandbox_cmd
        sandbox_cmd=$(build_command)

        # Execute with timeout
        local exit_code=0
        if command -v timeout &> /dev/null; then
            set +e
            if [[ -n "$sandbox_cmd" ]]; then
                OUTPUT=$(timeout "$TIMEOUT" $sandbox_cmd "$AGENT" "$TASK" ${AGENT_ARGS[@]+"${AGENT_ARGS[@]}"} 2>"$ERROR_FILE")
            else
                OUTPUT=$(timeout "$TIMEOUT" "$AGENT" "$TASK" ${AGENT_ARGS[@]+"${AGENT_ARGS[@]}"} 2>"$ERROR_FILE")
            fi
            exit_code=$?
            set -e
        else
            set +e
            if [[ -n "$sandbox_cmd" ]]; then
                OUTPUT=$($sandbox_cmd "$AGENT" "$TASK" ${AGENT_ARGS[@]+"${AGENT_ARGS[@]}"} 2>"$ERROR_FILE")
            else
                OUTPUT=$("$AGENT" "$TASK" ${AGENT_ARGS[@]+"${AGENT_ARGS[@]}"} 2>"$ERROR_FILE")
            fi
            exit_code=$?
            set -e
        fi

        # Handle exit codes
        case $exit_code in
            0)
                # Success
                echo "$OUTPUT" > "$OUTPUT_FILE"

                # Validate output format
                if validate_output "$OUTPUT" "$OUTPUT_FORMAT"; then
                    local detected_format
                    detected_format=$(detect_format "$OUTPUT")
                    [[ "$QUIET_MODE" == false ]] && log_success "Agent completed (format: $detected_format)"
                    echo "$OUTPUT"
                    return 0
                else
                    log_error "Output format validation failed"
                    return 1
                fi
                ;;
            124)
                log_error "Agent timed out after ${TIMEOUT}s"
                ;;
            126)
                log_error "Agent found but not executable"
                return 126
                ;;
            127)
                log_error "Agent not found"
                return 127
                ;;
            *)
                log_error "Agent failed with exit code $exit_code"
                if [ -s "$ERROR_FILE" ]; then
                    log_error "Error output:"
                    cat "$ERROR_FILE" >&2
                fi
                ;;
        esac

        # If this was the last attempt, fail
        if [ $attempt -eq $max_attempts ]; then
            return $exit_code
        fi
    done
}

# Main execution
main() {
    if [[ "$ASYNC_MODE" == true ]]; then
        # Run in background
        {
            execute_agent
            exit_code=$?
            echo "$exit_code" > "${PID_FILE}.exit"
        } &

        bg_pid=$!
        echo "$bg_pid" > "$PID_FILE"

        log_info "Agent running in background (PID: $bg_pid)"
        log_info "Output will be saved to: $OUTPUT_FILE"
        log_info "Check status with: kill -0 $bg_pid 2>/dev/null && echo 'running' || echo 'finished'"
        log_info "Get output with: cat $OUTPUT_FILE"

        echo "$RUN_ID"
    else
        # Run synchronously
        execute_agent
    fi
}

# Cleanup on exit
cleanup() {
    if [[ "$ASYNC_MODE" == false ]]; then
        # Clean up temporary files for sync execution
        rm -f "$ERROR_FILE" "$OUTPUT_FILE" "$PID_FILE" 2>/dev/null || true
    fi
}

trap cleanup EXIT

# Execute
main
