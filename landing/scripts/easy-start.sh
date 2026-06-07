#!/usr/bin/env bash
# PoH Miner Network - "One Command" Easy Starter
# Designed for normal people (Mac Mini users, Windows users with spare PCs, etc.)
#
# Usage:
#   curl -fsSL https://miner.proofofhuman.ge/scripts/easy-start.sh | bash
#   or run locally after cloning

set -e

BASE_URL="https://miner.proofofhuman.ge"

echo "============================================"
echo "  PoH Miner Network - Easy Start"
echo "  Run the decentralized AI brain. Earn POH."
echo "============================================"
echo ""

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

echo "Detected system: $OS ($ARCH)"

# Ensure Node.js (required for the miner)
if ! command -v node >/dev/null 2>&1; then
    echo "→ Node.js not found. Installing LTS via nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install --lts
    nvm use --lts
fi

INSTALL_DIR="${HOME}/.poh-miner"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 1. Ensure Ollama is installed
if ! command -v ollama >/dev/null 2>&1; then
    echo "→ Ollama not found. Installing..."
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "✓ Ollama is already installed"
fi

# 2. Choose best model for the hardware
MODEL="qwen2.5:1.5b"

if [[ "$OS" == "darwin" && "$ARCH" == "arm64" ]]; then
    echo "→ Apple Silicon Mac detected — Metal acceleration will be used automatically."
fi

echo "→ Pulling model: $MODEL ..."
ollama pull "$MODEL" || true

# 3. Detect GPU capability
echo ""
echo "→ Detecting hardware for inference mode..."

INFERENCE_MODE="auto"

if command -v nvidia-smi &> /dev/null && nvidia-smi --query-gpu=name --format=csv,noheader &> /dev/null; then
    echo "   ✓ NVIDIA GPU detected"
    INFERENCE_MODE="gpu"
elif [[ "$OS" == "darwin" && "$ARCH" == "arm64" ]]; then
    echo "   ✓ Apple Silicon detected (Metal will be used)"
    INFERENCE_MODE="gpu"
elif command -v rocm-smi &> /dev/null; then
    echo "   ✓ AMD ROCm GPU detected"
    INFERENCE_MODE="gpu"
else
    echo "   ℹ No dedicated GPU detected (will run on CPU)"
    INFERENCE_MODE="cpu"
fi

echo "   → inferenceMode: $INFERENCE_MODE"

# 4. Create default config if it doesn't exist
CONFIG_FILE="$INSTALL_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << EOF
{
  "wallet": "YOUR_SOLANA_ADDRESS_HERE",
  "ollamaUrl": "http://localhost:11434",
  "model": "$MODEL",
  "inferenceMode": "$INFERENCE_MODE",
  "autoStart": true,
  "bootnodes": [
    "http://45.38.249.208:8081"
  ],
  "rpc": {
    "solana": { "provider": "helius", "apiKey": "" },
    "1":     { "provider": "alchemy", "apiKey": "" },
    "8453":  { "provider": "alchemy", "apiKey": "" },
    "42161": { "provider": "alchemy", "apiKey": "" }
  },
  "rpcOverrides": {
    "btc": "https://mempool.space/api",
    "xlm": "https://horizon.stellar.org"
  },
  "etherscanApiKey": "",
  "pohWallet": "",
  "solanaAddress": "",
  "onboarded": false
}
EOF
    echo ""
    echo "⚠️  IMPORTANT: Edit $CONFIG_FILE and set your real Solana wallet address."
    echo "   (this is where you receive POH rewards)"
    echo ""
    echo "   Optionally add API keys for rpc.solana (Helius) and rpc.1 (Alchemy)"
    echo "   to enable more earning signals."
    echo ""
fi

# 5. Download miner code if not present
echo ""
echo "→ Setting up PoH Miner..."

if [ ! -d "$INSTALL_DIR/src" ]; then
    echo "   Downloading miner from $BASE_URL ..."
    TMP_DIR=$(mktemp -d)

    # Try to download the Linux binary appropriate for this arch
    if [[ "$OS" == "linux" && "$ARCH" == "x86_64" ]]; then
        BINARY_URL="$BASE_URL/binaries/poh-miner-linux-x64.AppImage"
        BINARY_DEST="$INSTALL_DIR/poh-miner.AppImage"
        echo "   Downloading AppImage for linux/x64..."
        if curl -fsSL "$BINARY_URL" -o "$BINARY_DEST"; then
            chmod +x "$BINARY_DEST"
            echo "   ✓ Downloaded AppImage to $BINARY_DEST"
            INSTALLED_AS="appimage"
        fi
    elif [[ "$OS" == "linux" && "$ARCH" == "aarch64" ]]; then
        BINARY_URL="$BASE_URL/binaries/poh-miner-linux-arm64.AppImage"
        BINARY_DEST="$INSTALL_DIR/poh-miner.AppImage"
        echo "   Downloading AppImage for linux/arm64..."
        if curl -fsSL "$BINARY_URL" -o "$BINARY_DEST"; then
            chmod +x "$BINARY_DEST"
            echo "   ✓ Downloaded AppImage to $BINARY_DEST"
            INSTALLED_AS="appimage"
        fi
    fi

    # Fallback: clone the repo and run headless
    if [ "${INSTALLED_AS:-}" != "appimage" ]; then
        echo "   No pre-built binary for $OS/$ARCH — cloning source..."
        if command -v git >/dev/null 2>&1; then
            git clone --depth 1 https://github.com/proofofhuman/poh-miner-network.git "$TMP_DIR/repo" 2>/dev/null && {
                cp -r "$TMP_DIR/repo"/. "$INSTALL_DIR/"
                rm -rf "$TMP_DIR"
                cd "$INSTALL_DIR"
                npm install --omit=dev 2>/dev/null || yarn install --production 2>/dev/null || true
            }
        else
            echo "❌ git not found. Please install git or download the miner manually from:"
            echo "   $BASE_URL"
            exit 1
        fi
    fi
fi

# 6. Create launcher
if [ "${INSTALLED_AS:-}" = "appimage" ]; then
    cat > "$INSTALL_DIR/start.sh" << LAUNCHER
#!/usr/bin/env bash
cd "\$(dirname "\$0")"
if grep -q "YOUR_SOLANA_ADDRESS_HERE" config.json 2>/dev/null; then
    echo "ERROR: Edit config.json and set your Solana wallet address first."
    exit 1
fi
echo "Starting PoH Miner..."
./poh-miner.AppImage --no-sandbox
LAUNCHER
else
    cat > "$INSTALL_DIR/start.sh" << LAUNCHER
#!/usr/bin/env bash
cd "\$(dirname "\$0")"
if grep -q "YOUR_SOLANA_ADDRESS_HERE" config.json 2>/dev/null; then
    echo "ERROR: Edit config.json and set your Solana wallet address first."
    exit 1
fi
echo "Starting PoH Miner Node (headless)..."
echo "Press Ctrl+C to stop."
node src/cli.js start
LAUNCHER
fi

chmod +x "$INSTALL_DIR/start.sh"

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit wallet address:  $CONFIG_FILE"
echo "  2. Start mining:         $INSTALL_DIR/start.sh"
echo ""

if [ "$INFERENCE_MODE" = "cpu" ]; then
  echo "CPU mode tip: run Ollama with  OLLAMA_NUM_GPU=0 ollama serve"
else
  echo "GPU mode tip: run Ollama with  ollama serve"
fi

echo ""
echo "Dashboard & downloads: https://miner.proofofhuman.ge"
