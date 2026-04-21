# FFT_nano Agent Container
# Runs Pi agent runtime in isolated Linux container with browser automation

FROM node:22-slim

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    python3-yaml \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser and pi (pi-coding-agent) globally
RUN npm install -g agent-browser @mariozechner/pi-coding-agent

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Install pi-autoresearch extension
COPY extensions/ /tmp/extensions/
RUN npm install -g typescript && \
    mkdir -p /home/node/.pi/agent/extensions/pi-autoresearch && \
    cp /tmp/extensions/pi-autoresearch/index.ts /home/node/.pi/agent/extensions/pi-autoresearch/ && \
    cd /home/node/.pi/agent/extensions/pi-autoresearch && \
    npx tsc --esModuleInterop --module commonjs --target es2022 --lib es2022 index.ts && \
    cp /tmp/extensions/pi-autoresearch/template.html /home/node/.pi/agent/extensions/pi-autoresearch/ && \
    rm /home/node/.pi/agent/extensions/pi-autoresearch/index.ts && \
    chown -R node:node /home/node/.pi/agent/extensions/

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks

# Create entrypoint script
# Runtime env is injected via stdin payload (no secret env file mounts).
RUN printf '#!/bin/bash\nset -e\ncat > /tmp/input.json\nnode /app/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
