#!/usr/bin/env bash
#
# Build a .deb package for the PoH Miner
#
# Requirements:
#   - fpm (gem install fpm) or use Docker
#   - The binary should already be built with `npm run build:bin`
#
# Output: dist/poh-miner_<version>_amd64.deb

set -e

VERSION=$(node -p "require('./package.json').version")
ARCH="amd64"
NAME="poh-miner"
MAINTAINER="PoH Network <team@proofofhuman.ge>"
DESCRIPTION="PoH Miner Network - Earn POH by contributing compute to the decentralized AI identity brain"

DIST_DIR="dist"
BIN_DIR="$DIST_DIR/bin"
DEB_DIR="$DIST_DIR/deb"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$DEB_DIR/usr/bin"
mkdir -p "$DEB_DIR/usr/share/applications"
mkdir -p "$DEB_DIR/usr/share/icons/hicolor/256x256/apps"

# Copy the pre-built Linux binary (produced by pkg)
if [ -f "$BIN_DIR/poh-miner-linux-x64" ]; then
    cp "$BIN_DIR/poh-miner-linux-x64" "$DEB_DIR/usr/bin/poh-miner"
    chmod +x "$DEB_DIR/usr/bin/poh-miner"
else
    echo "Error: Run 'npm run build:bin' first to generate the Linux binary."
    exit 1
fi

# Desktop entry (so it appears in menu and file managers)
cat > "$DEB_DIR/usr/share/applications/poh-miner.desktop" << EOF
[Desktop Entry]
Name=PoH Miner
Comment=Earn POH by contributing compute to the decentralized AI identity network
Exec=/usr/bin/poh-miner
Icon=poh-miner
Terminal=true
Type=Application
Categories=Network;Utility;Science;
Keywords=AI;Compute;Decentralized;POH;Identity;
StartupNotify=true
EOF

# Install icon (SVG is supported by modern desktops)
install -Dm644 "$ROOT_DIR/assets/icons/poh-miner.svg" \
  "$DEB_DIR/usr/share/icons/hicolor/scalable/apps/poh-miner.svg"

# Also install a 256x256 PNG if available (fallback)
if [ -f "$ROOT_DIR/assets/icons/poh-miner.png" ]; then
  install -Dm644 "$ROOT_DIR/assets/icons/poh-miner.png" \
    "$DEB_DIR/usr/share/icons/hicolor/256x256/apps/poh-miner.png"
fi

# postinst script: installs Ollama + pulls model on first dpkg install
mkdir -p "$DEB_DIR/DEBIAN"
cat > "$DEB_DIR/DEBIAN/postinst" << 'POSTINST'
#!/bin/bash
set -e

# Only run on fresh install (not upgrades)
if [ "$1" != "configure" ] && [ "$1" != "" ]; then exit 0; fi

echo "[PoH Miner] Checking Ollama..."

if ! command -v ollama &>/dev/null; then
    echo "[PoH Miner] Installing Ollama (required for AI inference)..."
    curl -fsSL https://ollama.com/install.sh | sh || {
        echo "[PoH Miner] WARNING: Ollama install failed. Run manually: curl -fsSL https://ollama.com/install.sh | sh"
        exit 0
    }
else
    echo "[PoH Miner] Ollama already installed: $(ollama --version 2>/dev/null || echo 'unknown')"
fi

# Start Ollama service if not running
if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "[PoH Miner] Starting Ollama service..."
    ollama serve &>/dev/null &
    sleep 3
fi

# Pull the model needed for brain inference
echo "[PoH Miner] Pulling qwen2.5:1.5b model (~900 MB, required for mining)..."
ollama pull qwen2.5:1.5b || echo "[PoH Miner] WARNING: Model pull failed. Run: ollama pull qwen2.5:1.5b"

echo "[PoH Miner] Setup complete."
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
echo "Then run: poh-miner"