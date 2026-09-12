#!/usr/bin/env bash
set -eo pipefail

# Configure virtual display for CloakBrowser/Chromium
export DISPLAY="${DISPLAY:-:99}"

# Clean up stale locks if container was restarted
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

echo "[docker-entrypoint] Starting Xvfb on ${DISPLAY} (1280x1024x24)..."
Xvfb "${DISPLAY}" -screen 0 1280x1024x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Wait for Xvfb socket to become ready
XVFB_READY=0
for i in $(seq 1 30); do
  if [ -S "/tmp/.X11-unix/X${DISPLAY#*:}" ]; then
    XVFB_READY=1
    break
  fi
  if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
    echo "[docker-entrypoint] ERROR: Xvfb process died unexpectedly during startup." >&2
    exit 1
  fi
  sleep 0.1
done

if [ "${XVFB_READY}" -ne 1 ]; then
  echo "[docker-entrypoint] WARNING: Xvfb socket not detected after 3 seconds, verifying process..."
  if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
    echo "[docker-entrypoint] ERROR: Xvfb is not running." >&2
    exit 1
  fi
fi

echo "[docker-entrypoint] Xvfb running successfully on ${DISPLAY} (PID: ${XVFB_PID})."
echo "[docker-entrypoint] Starting Daily Work Navigator server (HOST=${HOST:-0.0.0.0}, PORT=${PORT:-10000})..."

exec node hackathon-app/server.mjs
