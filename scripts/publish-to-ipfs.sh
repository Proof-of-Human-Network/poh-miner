#!/usr/bin/env bash
#
# Publish PoH Miner installer scripts (easy-start, download-latest, install.*), READMEs,
# landing page (with embedded CID links), and pre-built binaries/APKs to IPFS.
#
# Requirements: ipfs CLI installed and daemon running (or use --offline)
#
# Usage:
#   ./scripts/publish-to-ipfs.sh
#

set -e

echo "🚀 Publishing PoH Miner assets to IPFS..."

# Files and directories to publish (staged into a clean tree for IPFS)
ASSETS=(
  "scripts/easy-start.sh"
  "scripts/download-latest.sh"
  "scripts/serve-landing.js"
  "scripts/publish-to-ipfs.sh"
  "installers/install.sh"
  "installers/install-windows.ps1"
  "README.md"
  "README-EASY-INSTALL.md"
  "README-JOB-SYSTEM.md"
  "QUICKSTART.md"
  "QUICKSTART-EASY.md"
  "landing/index.html"
)

# Create a temporary directory with only the files we want to publish
TMP_DIR=$(mktemp -d)
echo "Staging files in $TMP_DIR"

mkdir -p "$TMP_DIR/scripts"
mkdir -p "$TMP_DIR/installers"
mkdir -p "$TMP_DIR/landing"
mkdir -p "$TMP_DIR/binaries"

# Copy original files (still containing placeholder)
cp scripts/easy-start.sh "$TMP_DIR/scripts/"
cp scripts/download-latest.sh "$TMP_DIR/scripts/"
cp scripts/serve-landing.js "$TMP_DIR/scripts/"
cp scripts/publish-to-ipfs.sh "$TMP_DIR/scripts/"
cp installers/install.sh "$TMP_DIR/installers/" 2>/dev/null || true
cp installers/install-windows.ps1 "$TMP_DIR/installers/" 2>/dev/null || true
cp README*.md "$TMP_DIR/" 2>/dev/null || true
cp QUICKSTART*.md "$TMP_DIR/" 2>/dev/null || true
cp landing/index.html "$TMP_DIR/landing/"
# Copy static assets from landing (e.g. the Android wallet APK for direct download)
mkdir -p "$TMP_DIR/landing/binaries"
cp landing/binaries/*.apk "$TMP_DIR/landing/binaries/" 2>/dev/null || true
cp landing/*.apk "$TMP_DIR/landing/" 2>/dev/null || true  # legacy location support

# Include pre-built binaries & packages (if present) so the landing's one-click
# download buttons in "Ready to contribute real compute?" work via IPFS.
if [ -d "dist/bin" ]; then
  cp dist/bin/poh-miner-* "$TMP_DIR/binaries/" 2>/dev/null || true
  echo "  + pkg binaries from dist/bin/"
fi
if [ -d "dist" ]; then
  # Normalize names for the landing download links
  if ls dist/*.deb >/dev/null 2>&1; then
    cp dist/*.deb "$TMP_DIR/binaries/poh-miner-linux-x64.deb" 2>/dev/null || true
  fi
  if ls dist/*.AppImage >/dev/null 2>&1; then
    cp dist/*.AppImage "$TMP_DIR/binaries/poh-miner-linux-x64.AppImage" 2>/dev/null || true
  fi
  echo "  + .deb / .AppImage (normalized names for landing)"
fi
# Windows NSIS or pkg exe
if ls dist/*poh-miner*.exe dist/*setup*.exe dist/*installer*.exe 2>/dev/null | head -1 >/dev/null; then
  cp $(ls dist/*poh-miner*.exe dist/*setup*.exe dist/*installer*.exe 2>/dev/null | head -1) "$TMP_DIR/binaries/poh-miner-windows-x64.exe" 2>/dev/null || true
fi
find installers -type f -name "*poh-miner*.exe" -exec cp {} "$TMP_DIR/binaries/poh-miner-windows-x64.exe" \; 2>/dev/null || true

# Add to IPFS (using files that still have placeholder — this is fine,
# because we will update the *working tree* files after we have the CID)
echo ""
echo "Adding to IPFS..."
CID=$(ipfs add -r --quieter --pin=true "$TMP_DIR" | tail -n 1)

echo ""
echo "✅ Published to IPFS!"
echo ""
echo "Root CID: $CID"
echo ""
echo "Direct links (via public gateways):"
echo "  https://ipfs.io/ipfs/$CID/"
echo "  https://gateway.pinata.cloud/ipfs/$CID/"
echo ""
echo "Key files:"
echo "  Easy installer (Mac/Linux): https://ipfs.io/ipfs/$CID/scripts/easy-start.sh"
echo "  Universal installer:        https://ipfs.io/ipfs/$CID/installers/install.sh"
echo "  Windows installer (PS1):    https://ipfs.io/ipfs/$CID/installers/install-windows.ps1"
echo "  download-latest helper:     https://ipfs.io/ipfs/$CID/scripts/download-latest.sh"
echo "  Landing page:               https://ipfs.io/ipfs/$CID/landing/index.html"
echo ""
echo "Pre-built binaries (for the one-click cards on landing):"
ls -1 "$TMP_DIR/binaries/" 2>/dev/null | sed 's/^/  - /'
echo "  (download e.g. https://ipfs.io/ipfs/$CID/binaries/poh-miner-linux-x64.deb )"
echo ""

# Update the *published* copy of the landing page with the real CID
# so the version on IPFS already has correct download links
if [ -f "$TMP_DIR/landing/index.html" ]; then
  sed -i.bak "s|QmReplaceWithActualCID|$CID|g" "$TMP_DIR/landing/index.html"
  # Re-add just the landing to get an updated sub-CID (optional but nice)
  LANDING_CID=$(ipfs add -r --quieter --pin=true "$TMP_DIR/landing" | tail -n 1)
  echo "Landing page re-published with correct links. New landing CID: $LANDING_CID"
fi

# Now that we have the real CID, update the source files in the working tree
echo ""
echo "→ Automatically updating source files with new CID: $CID"

PLACEHOLDER="QmReplaceWithActualCID"

sed -i.bak "s|$PLACEHOLDER|$CID|g" scripts/easy-start.sh
sed -i.bak "s|$PLACEHOLDER|$CID|g" installers/install-windows.ps1
sed -i.bak "s|$PLACEHOLDER|$CID|g" scripts/download-latest.sh
sed -i.bak "s|$PLACEHOLDER|$CID|g" landing/index.html

# Clean up sed backup files
rm -f scripts/easy-start.sh.bak \
      installers/install-windows.ps1.bak \
      scripts/download-latest.sh.bak \
      landing/index.html.bak

# Automatically update CID tracking files
echo "$CID" > ipfs/latest.txt
echo "$CID" > ipfs/scripts.txt
echo "$CID" > ipfs/binaries.txt   # always update — binaries/ dir is included when builds exist

echo "✅ Source files and CID tracking files have been updated automatically."
echo ""
echo "Don't forget to commit the changes to the source files!"

# Cleanup
rm -rf "$TMP_DIR"

echo ""
echo "Tip: Pin this CID on your own IPFS node or a pinning service (Pinata, Web3.Storage, etc.)"