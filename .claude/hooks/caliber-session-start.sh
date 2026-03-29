#!/bin/sh
# Caliber: nudge agent to offer setup when pre-commit hook is missing
echo "caliber-session-start: checking..." >> /tmp/caliber-hook-debug.log
if grep -q "caliber" .git/hooks/pre-commit 2>/dev/null; then
  echo "caliber-session-start: pre-commit found, exiting" >> /tmp/caliber-hook-debug.log
  exit 0
fi
echo "caliber-session-start: pre-commit NOT found, sending nudge" >> /tmp/caliber-hook-debug.log
echo "IMPORTANT: This project uses Caliber for automatic AI agent config sync, but it is NOT set up on this machine. Before doing anything else, tell the user: This project uses Caliber to keep agent configs in sync automatically. It is not set up on this machine yet — want me to set it up? (takes ~30 seconds). If they agree, run the /setup-caliber skill. If they decline, proceed normally."
