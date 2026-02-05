#!/usr/bin/env bash
# Convenience wrapper for building the agent image on Linux (Docker).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/container/build-docker.sh" "$@"

