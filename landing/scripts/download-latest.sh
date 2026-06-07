#!/usr/bin/env bash
#
# download-latest.sh
#
# Downloads the latest PoH Miner binary for your platform from IPFS.
# Falls back to GitHub releases if IPFS is unavailable.
#
# Usage:
#   ./scripts/download-latest.sh
#   ./scripts/download-latest.sh --install   # also install to ~/.local/bin
#

set -e

IPFS_CID_FILE="$(dirname "$0")/../ipfs/binaries.txt"
GITHUB_RELEASES="https://github.com/poh/poh-miner-network/releases/latest/download"

if [ -f "$IPFS_CID_FILE" ]; then
  CID=$(cat "$IPFS_CID_FILE" | tr -d '[:space:]')
else
  CID=""
fi

IPFS_GATEWAYS=(
  "https://ipfs.io/ipfs"
  "https://gateway.pinata.cloud/ipfs"
  "https://cloudflare-ipfs.com/ipfs"
)

detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$OS" in
    linux*)
      case "$ARCH" in
        x86_64)   echo "linux-x64" ;;
        aarch64|arm64) echo "linux-arm64" ;;
        *) echo "unsupported" ;;
      esac
      ;;
    darwin*)
      case "$ARCH" in
        x86_64)   echo "macos-x64" ;;
        arm64)    echo "macos-arm64" ;;
        *) echo "unsupported" ;;
      esac
      ;;
    msys*|cygwin*|mingw*)
      echo "win-x64"
      ;;
    *)
      echo "unsupported"
      ;;
  esac
}

PLATFORM=$(detect_platform)

if [ "$PLATFORM" = "unsupported" ]; then
  echo "Unsupported platform: $(uname -s) $(uname -m)"
  exit 1
fi

FILENAME="poh-miner-${PLATFORM}"
if [[ "$PLATFORM" == win-* ]]; then
  FILENAME="${FILENAME}.exe"
fi

echo "Detected platform: $PLATFORM"
echo "Looking for: $FILENAME"

download_from_ipfs() {
  local url="$1/$CID/binaries/$FILENAME"
  echo "→ Trying IPFS: $url"
  if curl -fsSL -o "$FILENAME" "$url"; then
    echo "✓ Downloaded from IPFS"
    return 0
  fi
  return 1
}

download_from_github() {
  local url="$GITHUB_RELEASES/$FILENAME"
  echo "→ Trying GitHub: $url"
  if curl -fsSL -L -o "$FILENAME" "$url"; then
    echo "✓ Downloaded from GitHub"
    return 0
  fi
  return 1
}

success=false

if [ -n "$CID" ] && [ "$CID" != "QmReplaceWithActualCID" ]; then
  for gateway in "${IPFS_GATEWAYS[@]}"; do
    if download_from_ipfs "$gateway"; then
      success=true
      break
    fi
  done
fi

if [ "$success" = false ]; then
  if download_from_github; then
    success=true
  fi
fi

if [ "$success" = false ]; then
  echo "❌ Failed to download from all sources."
  exit 1
fi

chmod +x "$FILENAME" 2>/dev/null || true

echo ""
echo "✅ Downloaded: $FILENAME"

if [[ "$1" == "--install" || "$1" == "-i" ]]; then
  mkdir -p "$HOME/.local/bin"
  mv "$FILENAME" "$HOME/.local/bin/poh-miner"
  echo "Installed to ~/.local/bin/poh-miner"
  echo "Make sure ~/.local/bin is in your PATH."
else
  echo "Run with: ./$FILENAME"
  echo "Or re-run with --install to put it in ~/.local/bin"
fi

echo ""
echo "After first run, configure with: poh-miner init"