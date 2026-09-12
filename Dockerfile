# syntax=docker/dockerfile:1
FROM --platform=linux/amd64 node:22-bookworm-slim

# Avoid interactive dialogs during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install required system packages:
# - git: required by Webcmd site memory and git-store checkpointing
# - ca-certificates & curl: network security and asset downloads
# - xvfb & x11-utils: virtual display server required for CloakBrowser headed Chromium
# - Linux shared libraries required by Chromium on Debian 12 (Bookworm)
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    xvfb \
    x11-utils \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    libxshmfence1 \
    libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/*

# Set application working directory
WORKDIR /app

# Configure deployment environment variables (PORT is provided dynamically at runtime by Render)
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DISPLAY=:99 \
    CLOAKBROWSER_CACHE_DIR=/root/.cloakbrowser

# Copy project configuration, source code, build scripts, and application files into container
COPY package.json package-lock.json tsconfig.json cli-manifest.json plugin-catalog.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY skills/ ./skills/
COPY hackathon-app/ ./hackathon-app/

# Install dependencies (including build tools), compile dist/, and prune devDependencies
RUN npm ci --include=dev && \
    npm run build && \
    npm prune --omit=dev

# Normalize entrypoint script line endings and set execute permissions
RUN sed -i 's/\r$//' hackathon-app/docker-entrypoint.sh && \
    chmod +x hackathon-app/docker-entrypoint.sh dist/src/main.js

# Pre-download and install Linux CloakBrowser Chromium binary at build time
RUN npx cloakbrowser install

# Documentation port for Render Web Service (actual port bound dynamically via $PORT)
EXPOSE 10000

# Launch server with Xvfb virtual framebuffer via entrypoint script
ENTRYPOINT ["/bin/bash", "hackathon-app/docker-entrypoint.sh"]
