#!/bin/bash
# Build the FFT_nano agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="fft-nano-agent"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

if [[ "${TAG}" == "-h" || "${TAG}" == "--help" ]]; then
  echo "Usage: ./container/build.sh [tag]"
  echo ""
  echo "Builds the FFT_nano agent image using the selected container runtime."
  echo "Set CONTAINER_RUNTIME=docker|container (default: docker)."
  echo "Example:"
  echo "  CONTAINER_RUNTIME=docker ./container/build.sh latest"
  exit 0
fi

echo "Building FFT_nano agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"
echo "Runtime: ${CONTAINER_RUNTIME}"

${CONTAINER_RUNTIME} build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${CONTAINER_RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
