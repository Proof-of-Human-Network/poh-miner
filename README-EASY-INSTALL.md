# Easy Installation Guide

This guide is written for normal humans — not just hardcore miners.

## One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/poh/poh-miner-network/main/scripts/easy-start.sh | bash
```

This script will:
- Set up the miner (inference runs in-process via QVAC — nothing extra to install)
- Create a clean config at `~/.poh-miner/config.json`
- Give you a simple `start.sh`

The AI model (default `qwen3-1.7b`) is downloaded automatically the first time
the miner needs it — no separate engine or `pull` step.

## After Installation

1. Edit `~/.poh-miner/config.json` and set your Solana wallet address (this receives POH rewards).
2. Run `./start.sh` (or `poh-miner start` after global install).

## Platform Specific Notes & GPU/CPU Choice

The installer now detects your hardware and sets `inferenceMode` automatically in `config.json`:

- `"gpu"` → Use GPU acceleration (NVIDIA CUDA, Apple Metal, AMD ROCm)
- `"cpu"` → Force CPU-only (recommended for VPS or machines without GPU)
- `"auto"` → Let QVAC decide (default)

You can change this anytime in `config.json`. This gives you full control:
- Run with GPU on your gaming PC / mining rig companion
- Run in pure CPU mode on a cheap VPS without GPU

### Mac (especially Mac Mini M1–M4)
- Excellent experience. QVAC uses Apple Metal automatically.
- Installer will set `inferenceMode: "gpu"`.
- Very low power draw while idle.

### Windows
- Download the PoH Miner `.exe` from [miner.proofofhuman.ge](https://miner.proofofhuman.ge) and run it.
- No engine to install — QVAC runs in-process; the model downloads on first launch.
- Works great on gaming PCs (will detect NVIDIA GPU automatically).
- For VPS or no-GPU machines, manually set `"inferenceMode": "cpu"` in config.
- **Model still downloading?** The miner still works — chat and skills are relayed to peer miners on the network that already have the model.

### Linux / Raspberry Pi / VPS
- The bash installer works perfectly.
- On machines without GPU, it will default to `cpu`.
- For best CPU performance on VPS, consider a smaller model (e.g. `qwen3-0.6b`).

### Manually Changing Mode Later

Edit `~/.poh-miner/config.json`:

```json
{
  "inferenceMode": "cpu",     // or "gpu" or "auto"
  "model": "qwen3-1.7b"
}
```

Then restart the miner.

## Model Selection

Inference runs in-process via **QVAC** — there is no separate server to run and
no `pull` step. Set `model` in `config.json` to any of:

- a built-in QVAC id/alias: `qwen3-0.6b`, `qwen3-1.7b` (default), `qwen3-4b`, `qwen3-8b`
- a direct GGUF URL (e.g. a HuggingFace `*.gguf`)

The model downloads automatically the first time it's used. Larger models give
better answers but need more RAM/VRAM. You can also switch models live from the
model picker in the desktop app (Settings and above the chat box).

## Need Help?

Join the discussion on proofofhuman.ge or open an issue on GitHub.
