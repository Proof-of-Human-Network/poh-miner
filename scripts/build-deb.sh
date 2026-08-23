#!/usr/bin/env bash
#
# Build a .deb package for the DAI Miner
#
# Requirements:
#   - fpm (gem install fpm) or use Docker
#   - The binary should already be built with `npm run build:bin`
#
# Output: dist/dai-miner_<version>_amd64.deb

set -e

VERSION=$(node -p "require('./package.json').version")
ARCH="amd64"
NAME="dai-miner"
MAINTAINER="DAI Network <team@iamai.kg>"
DESCRIPTION="DAI Miner Network - Earn DAI by contributing compute to the decentralized AI identity brain"

DIST_DIR="dist"
BIN_DIR="$DIST_DIR/bin"
DEB_DIR="$DIST_DIR/deb"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$DEB_DIR/usr/bin"
mkdir -p "$DEB_DIR/usr/share/applications"
mkdir -p "$DEB_DIR/usr/share/icons/hicolor/256x256/apps"

# Copy the pre-built Linux binary (produced by pkg)
if [ -f "$BIN_DIR/dai-miner-linux-x64" ]; then
    cp "$BIN_DIR/dai-miner-linux-x64" "$DEB_DIR/usr/bin/dai-miner"
    chmod +x "$DEB_DIR/usr/bin/dai-miner"
else
    echo "Error: Run 'npm run build:bin' first to generate the Linux binary."
    exit 1
fi

# Desktop entry (so it appears in menu and file managers)
cat > "$DEB_DIR/usr/share/applications/dai-miner.desktop" << EOF
[Desktop Entry]
Name=DAI Miner
Comment=Earn DAI by contributing compute to the decentralized AI identity network
Exec=/usr/bin/dai-miner
Icon=dai-miner
Terminal=true
Type=Application
Categories=Network;Utility;Science;
Keywords=AI;Compute;Decentralized;DAI;Identity;
StartupNotify=true
EOF

# Install icon (SVG is supported by modern desktops)
install -Dm644 "$ROOT_DIR/assets/icons/dai-miner.svg" \
  "$DEB_DIR/usr/share/icons/hicolor/scalable/apps/dai-miner.svg"

# Also install a 256x256 PNG if available (fallback)
if [ -f "$ROOT_DIR/assets/icons/dai-miner.png" ]; then
  install -Dm644 "$ROOT_DIR/assets/icons/dai-miner.png" \
    "$DEB_DIR/usr/share/icons/hicolor/256x256/apps/dai-miner.png"
fi

# postinst script: nothing to install for inference — QVAC runs in-process
# via the bundled @qvac/sdk dependency and downloads its model on first run.
mkdir -p "$DEB_DIR/DEBIAN"
cat > "$DEB_DIR/DEBIAN/postinst" << 'POSTINST'
#!/bin/bash
set -e

# Only run on fresh install (not upgrades)
if [ "$1" != "configure" ] && [ "$1" != "" ]; then exit 0; fi

echo "[DAI Miner] Inference runs in-process via QVAC (no Ollama)."
echo "[DAI Miner] The model (default qwen3-1.7b) downloads automatically on first run."
echo "[DAI Miner] Setup complete."
POSTINST
chmod 0755 "$DEB_DIR/DEBIAN/postinst"

# Build the .deb using fpm if available
if command -v fpm &> /dev/null; then
    fpm -s dir -t deb \
        -n "$NAME" \
        -v "$VERSION" \
        -a "$ARCH" \
        --description "$DESCRIPTION" \
        --maintainer "$MAINTAINER" \
        -C "$DEB_DIR" \
        -p "$DIST_DIR/${NAME}_${VERSION}_${ARCH}.deb" \
        usr/
    echo ""
    echo "✅ .deb package created: $DIST_DIR/${NAME}_${VERSION}_${ARCH}.deb"
else
    echo "fpm not found. Install with: gem install fpm"
    echo "The prepared files are in $DEB_DIR"
    echo "You can manually build the .deb or use Docker."
fi

echo ""
echo "To install locally: sudo dpkg -i $DIST_DIR/${NAME}_${VERSION}_${ARCH}.deb"
echo "Then run: dai-miner"