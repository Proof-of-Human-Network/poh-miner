#!/usr/bin/env bash
# PoH Miner Network - "One Command" Easy Starter
# Designed for normal people (Mac Mini users, Windows users with spare PCs, etc.)
#
# Usage:
#   curl -fsSL https://.../easy-start.sh | bash
#   or run locally after cloning

set -e

# === IPFS-first distribution ===
# Update this after running: ./scripts/publish-to-ipfs.sh
IPFS_CID="QmReplaceWithActualCID"

IPFS_GATEWAYS=(
  "https://ipfs.io/ipfs/${IPFS_CID}"
  "https://gateway.pinata.cloud/ipfs/${IPFS_CID}"
  "https://cloudflare-ipfs.com/ipfs/${IPFS_CID}"
)

GITHUB_RAW="https://raw.githubusercontent.com/poh/poh-miner-network/main"

echo "============================================"
echo "  PoH Miner Network - Easy Start"
echo "  Run the decentralized AI brain. Earn POH."
echo "============================================"
echo ""

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

echo "Detected system: $OS ($ARCH)"

# Download helper: prefers IPFS gateways, falls back to GitHub
download_file() {
  local path="$1"      # e.g. scripts/easy-start.sh
  local dest="$2"

  echo "→ Downloading $path ..."

  # Try IPFS gateways first
  if [ -n "$IPFS_CID" ] && [ "$IPFS_CID" != "QmReplaceWithActualCID" ]; then
    for gateway in "${IPFS_GATEWAYS[@]}"; do
      if curl -fsSL "$gateway/$path" -o "$dest" 2>/dev/null; then
        echo "   ✓ Downloaded from IPFS ($gateway)"
        return 0
      fi
    done
    echo "   IPFS gateways unavailable, falling back to GitHub..."
  fi

  # Fallback to GitHub
  if curl -fsSL "$GITHUB_RAW/$path" -o "$dest"; then
    echo "   ✓ Downloaded from GitHub"
    return 0
  fi

  echo "❌ Failed to download $path from all sources"
  return 1
}

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

# 1. Ensure Ollama is installed (best universal LLM runner)
if ! command -v ollama >/dev/null 2>&1; then
    echo "→ Ollama not found. Installing (this is the easiest way to run local AI)..."
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

# 3. Detect GPU capability for inference mode selection
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

echo "   → Recommended inferenceMode: $INFERENCE_MODE"
echo "     (You can change this later in config.json)"

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
  "region": "auto",

  "solanaRpc": "",
  "rpcEndpoints": {
    "1": "",
    "8453": ""
  }
}
EOF
    echo ""
    echo "⚠️  IMPORTANT: Edit $CONFIG_FILE and put your real Solana wallet address"
    echo "   (this is where you will receive POH rewards)"
    echo ""
    echo "   You MUST also configure RPC endpoints:"
    echo "     - solanaRpc  (required by many signals, especially Meteora curves)"
    echo "     - rpcEndpoints (recommended for EVM-based signals)"
    echo ""
    echo "   The miner will refuse to start if critical RPCs are missing."
    echo ""
    echo "   inferenceMode is set to: $INFERENCE_MODE"
    echo "   → Change to \"cpu\" if running on a VPS without GPU"
fi

# 5. Ensure we have the miner code (prefer IPFS when available)
echo ""
echo "→ Setting up PoH Miner..."

if [ ! -d "$INSTALL_DIR/src" ]; then
    if [ -n "$IPFS_CID" ] && [ "$IPFS_CID" != "QmReplaceWithActualCID" ]; then
        echo "   Trying to fetch full project from IPFS..."
        for gateway in "${IPFS_GATEWAYS[@]}"; do
            if curl -fsSL "$gateway" -o /dev/null 2>/dev/null; then  # crude check
                # For full directory it's better to use ipfs CLI if available
                if command -v ipfs &> /dev/null; then
                    echo "   Using local ipfs to get /ipfs/$IPFS_CID ..."
                    ipfs get "/ipfs/$IPFS_CID" -o "$INSTALL_DIR/repo-tmp" 2>/dev/null && {
                        mv "$INSTALL_DIR/repo-tmp"/* "$INSTALL_DIR/" 2>/dev/null || true
                        rm -rf "$INSTALL_DIR/repo-tmp"
                        echo "   ✓ Fetched from local IPFS"
                        break
                    }
                fi
            fi
        done
    fi

    if [ ! -d "$INSTALL_DIR/src" ]; then
        echo "   Falling back to git clone..."
        git clone --depth 1 https://github.com/poh/poh-miner-network.git "$INSTALL_DIR/repo-tmp" 2>/dev/null || {
            echo "Git clone failed. Please manually clone the repo into $INSTALL_DIR"
            exit 1
        }
        mv "$INSTALL_DIR/repo-tmp"/* "$INSTALL_DIR/" 2>/dev/null || true
        rm -rf "$INSTALL_DIR/repo-tmp"
    fi
fi

# Create convenient launcher
cat > "$INSTALL_DIR/start.sh" << 'LAUNCHER'
#!/usr/bin/env bash
cd "$(dirname "$0")"

if grep -q "YOUR_SOLANA_ADDRESS_HERE" config.json 2>/dev/null; then
    echo "ERROR: Edit config.json and set your real Solana wallet address first."
    exit 1
fi

echo "Starting PoH Miner Node..."
echo "Press Ctrl+C to stop."

if command -v node >/dev/null 2>&1; then
    node src/cli.js start
else
    echo "Node.js required. Install from https://nodejs.org"
    exit 1
fi
LAUNCHER

chmod +x "$INSTALL_DIR/start.sh"

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit your wallet in:      $CONFIG_FILE"
echo "  2. (Optional) Adjust inferenceMode in the config"
echo "  3. Start mining:             $INSTALL_DIR/start.sh"
echo ""
echo "Alternative (after npm install -g):"
echo "  poh-miner start"
echo ""
echo "Ollama tips based on your inferenceMode ($INFERENCE_MODE):"

if [ "$INFERENCE_MODE" = "cpu" ]; then
  echo "  For pure CPU mode, run Ollama like this:"
  echo "    OLLAMA_NUM_GPU=0 ollama serve"
else
  echo "  For GPU mode, just run: ollama serve"
fi

echo ""
echo "Full guide: https://github.com/poh/poh-miner-network"
