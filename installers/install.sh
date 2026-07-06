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

# 1. Inference engine — QVAC runs in-process via the @qvac/sdk npm dependency.
# There is no separate engine to install and no model to pull here: the model
# (default qwen3-1.7b) is fetched automatically on first use.
echo "→ Inference: QVAC (in-process, no Ollama). Model downloads on first run."

# QVAC's llama.cpp backend needs the Vulkan runtime. On GPU-less hosts (e.g. a
# headless VPS) this installs the loader + a CPU software driver so QVAC runs.
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/ensure-vulkan.sh" || true

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
