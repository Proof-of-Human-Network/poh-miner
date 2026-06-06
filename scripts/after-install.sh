#!/bin/bash
# Patch the .desktop file to add --no-sandbox so Electron's Zygote
# doesn't fail on Linux kernels that restrict user namespaces.
DESKTOP_FILE="/usr/share/applications/poh-miner.desktop"
if [ -f "$DESKTOP_FILE" ]; then
  # Only patch if not already patched
  if ! grep -q -- '--no-sandbox' "$DESKTOP_FILE"; then
    sed -i 's|^Exec=\(.*\) %U$|Exec=\1 --no-sandbox %U|' "$DESKTOP_FILE"
    sed -i 's|^Exec=\(.*\)$|Exec=\1 --no-sandbox|' "$DESKTOP_FILE"
  fi
fi
