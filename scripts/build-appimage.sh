#!/usr/bin/env bash
#
# Build an AppImage for PoH Miner (excellent "double-click to run" experience on Linux)
#
# Requirements: appimagetool (download from https://github.com/AppImage/AppImageKit/releases)
#

set -e

VERSION=$(node -p "require('./package.json').version")
DIST_DIR="dist"
BIN="$DIST_DIR/bin/poh-miner-linux-x64"

if [ ! -f "$BIN" ]; then
    echo "Binary not found. Run 'npm run build:bin' first."
    exit 1
fi

APPDIR="$DIST_DIR/AppDir"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/share/applications"
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"

cp "$BIN" "$APPDIR/usr/bin/poh-miner"
chmod +x "$APPDIR/usr/bin/poh-miner"

# Desktop file
cat > "$APPDIR/poh-miner.desktop" << EOF
[Desktop Entry]
Name=PoH Miner
Exec=poh-miner
Icon=poh-miner
Type=Application
Categories=Network;
Terminal=true
EOF

cp "$APPDIR/poh-miner.desktop" "$APPDIR/usr/share/applications/"

# Simple icon (replace with real one)
touch "$APPDIR/poh-miner.png"

# Create AppRun
cat > "$APPDIR/AppRun" << 'EOF'
#!/bin/sh
SELF=$(readlink -f "$0")
HERE=${SELF%/*}
export PATH="${HERE}/usr/bin:${PATH}"
exec "${HERE}/usr/bin/poh-miner" "$@"
EOF
chmod +x "$APPDIR/AppRun"

echo "AppDir prepared at $APPDIR"
echo "Now run: appimagetool $APPDIR $DIST_DIR/poh-miner-${VERSION}-x86_64.AppImage"