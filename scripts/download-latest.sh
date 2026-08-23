#!/usr/bin/env bash
#
# download-latest.sh  —  Download the latest DAI Miner binary for your platform.
#
# Usage:
#   ./scripts/download-latest.sh
#   ./scripts/download-latest.sh --install   # also install to ~/.local/bin
#

set -e

BASE_URL="https://miner.iamai.kg"

detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$OS" in
    linux*)
      case "$ARCH" in
        x86_64)        echo "linux-x64" ;;
        aarch64|arm64) echo "linux-arm64" ;;
        *) echo "unsupported" ;;
      esac
      ;;
    darwin*)
      case "$ARCH" in
        x86_64) echo "macos-x64" ;;
        arm64)  echo "macos-arm64" ;;
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

case "$PLATFORM" in
  linux-x64)   FILENAME="dai-miner-linux-x64.AppImage" ;;
  linux-arm64) FILENAME="dai-miner-linux-arm64.AppImage" ;;
  win-x64)     FILENAME="dai-miner-windows-x64.exe" ;;
  macos-*)     echo "macOS builds are coming soon. Use the AppImage on Linux."; exit 0 ;;
esac

DOWNLOAD_URL="$BASE_URL/binaries/$FILENAME"
echo "Detected platform: $PLATFORM"
echo "Downloading: $DOWNLOAD_URL"

if ! curl -fsSL -o "$FILENAME" "$DOWNLOAD_URL"; then
  echo "❌ Download failed. Check https://miner.iamai.kg for manual downloads."
  exit 1
fi

chmod +x "$FILENAME" 2>/dev/null || true

echo ""
echo "✅ Downloaded: $FILENAME"

if [[ "$1" == "--install" || "$1" == "-i" ]]; then
  mkdir -p "$HOME/.local/bin"
  mv "$FILENAME" "$HOME/.local/bin/dai-miner"
  echo "Installed to ~/.local/bin/dai-miner"
  echo "Make sure ~/.local/bin is in your PATH."
else
  echo "Run with: ./$FILENAME"
  echo "Or re-run with --install to put it in ~/.local/bin"
fi

echo ""
echo "Source + build scripts: https://github.com/Proof-of-Human-Network/poh-miner"
