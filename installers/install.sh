#!/usr/bin/env bash
# Universal installer for PoH Miner Network
# Works on macOS, Linux, Raspberry Pi, etc.
# Designed to be as easy as possible for non-miners (Mac Mini users, etc.)

set -e

echo "=========================================="
echo "  PoH Miner Network - Easy Installer"
echo "=========================================="
echo ""
echo "This will set up the PoH miner so you can earn POH"
echo "by contributing compute (especially good on Apple Silicon Macs)."
echo ""

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

echo "Detected: $OS on $ARCH"

# 1. Install Ollama if missing (best universal way to run LLMs locally)
if ! command -v ollama &> /dev/null; then
    echo "→ Installing Ollama (recommended inference engine)..."
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "✓ Ollama already installed"
fi

# 2. Pull a good small model
echo "→ Pulling efficient model for this hardware..."
if [[ "$ARCH" == "arm64" && "$OS" == "Darwin" ]]; then
    ollama pull qwen2.5:1.5b || ollama pull phi3:mini
else
    ollama pull qwen2.5:1.5b
fi

# 3. Create working directory
INSTALL_DIR="$HOME/.poh-miner"
mkdir -p "$INSTALL_DIR"

echo ""
echo "✓ Base environment ready."
echo ""
echo "Next steps:"
echo "  1. cd $INSTALL_DIR"
echo "  2. Download the latest release binary for your platform"
echo "  3. Run ./poh-miner (or the installer for your OS)"
echo ""
echo "For the absolute easiest experience on Mac:"
echo "  brew tap poh/tap && brew install poh-miner"
echo ""
echo "Full instructions: https://github.com/poh/poh-miner-network"
