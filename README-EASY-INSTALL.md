# Easy Installation Guide

This guide is written for normal humans — not just hardcore miners.

## One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/poh/poh-miner-network/main/scripts/easy-start.sh | bash
```

This script will:
- Install Ollama (best way to run local LLMs)
- Pull an efficient model suitable for your hardware
- Create a clean config at `~/.poh-miner/config.json`
- Give you a simple `start.sh`

## After Installation

1. Edit `~/.poh-miner/config.json` and set your Solana wallet address (this receives POH rewards).
2. Run `./start.sh` (or `poh-miner start` after global install).

## Platform Specific Notes & GPU/CPU Choice

The installer now detects your hardware and sets `inferenceMode` automatically in `config.json`:

- `"gpu"` → Use GPU acceleration (NVIDIA CUDA, Apple Metal, AMD ROCm)
- `"cpu"` → Force CPU-only (recommended for VPS or machines without GPU)
- `"auto"` → Let Ollama decide (default)

You can change this anytime in `config.json`. This gives you full control:
- Run with GPU on your gaming PC / mining rig companion
- Run in pure CPU mode on a cheap VPS without GPU

### Mac (especially Mac Mini M1–M4)
- Excellent experience. Ollama uses Apple Metal automatically.
- Installer will set `inferenceMode: "gpu"`.
- Very low power draw while idle.

### Windows
- Download and install [Ollama for Windows](https://ollama.com/download) first (one-click installer).
- Then run the PowerShell installer — it pulls the model and sets up config automatically:
  ```powershell
  irm https://miner.proofofhuman.ge/installers/install-windows.ps1 | iex
  ```
- Works great on gaming PCs (will detect NVIDIA GPU automatically).
- For VPS or no-GPU machines, manually set `"inferenceMode": "cpu"` in config.
- **No Ollama / can't install?** The miner still works — chat and skills are relayed to peer miners on the network that have Ollama.

### Linux / Raspberry Pi / VPS
- The bash installer works perfectly.
- On machines without GPU, it will default to `cpu`.
- For best CPU performance on VPS, consider using a smaller model (e.g. `qwen2.5:0.5b` or `phi3:mini`).

### Manually Changing Mode Later

Edit `~/.poh-miner/config.json`:

```json
{
  "inferenceMode": "cpu",     // or "gpu" or "auto"
  "model": "qwen2.5:1.5b"
}
```

Then restart the miner.

### How to Run Ollama in Different Modes

**For CPU-only (recommended on VPS):**
```bash
OLLAMA_NUM_GPU=0 ollama serve
```

**For GPU (default behavior on machines with GPU):**
```bash
ollama serve
```

You can also set the environment variable permanently:

**Linux / macOS** (in your shell profile):
```bash
export OLLAMA_NUM_GPU=0     # for CPU mode
```

**Windows (PowerShell):**
```powershell
$env:OLLAMA_NUM_GPU=0
ollama serve
```

**Pro tip:** You can run Ollama with different settings per terminal/session depending on what you need. The miner will connect to whatever Ollama is running at `ollamaUrl`.

## Auto Model Selection

The installer picks a good small model (`qwen2.5:1.5b` by default). On Apple Silicon it still performs very well thanks to Metal.

Future versions will offer even faster backends (MLX, llama.cpp with Metal, etc.).

## Need Help?

Join the discussion on proofofhuman.ge or open an issue on GitHub.
