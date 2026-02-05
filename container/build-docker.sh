#!/bin/bash
# Build the FFT_nano agent container image with Docker

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="fft-nano-agent"
TAG="${1:-latest}"

if [[ "${TAG}" == "-h" || "${TAG}" == "--help" ]]; then
  echo "Usage: ./container/build-docker.sh [tag]"
  echo ""
  echo "Builds the FFT_nano agent image using Docker."
  echo "Example:"
  echo "  ./container/build-docker.sh latest"
  exit 0
fi

echo "Building FFT_nano agent container image (Docker)..."
echo "Image: ${IMAGE_NAME}:${TAG}"

docker build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
