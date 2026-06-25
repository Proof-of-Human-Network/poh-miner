# Super Easy Start (Mac Mini, Windows, Linux, Pi)

We are making this as easy as possible so that **anyone** with spare compute can join.

## Windows (GUI — easiest)

1. Download **[PoH-Miner.exe](https://miner.proofofhuman.ge/binaries/poh-miner-windows-x64.exe)** and run it.
2. Install **[Ollama for Windows](https://ollama.com/download)** (one-click, ~100 MB).
3. Restart the miner — it pulls the model and starts mining automatically.

No Ollama yet? You can still use the miner — chat and skill queries fall back to peer miners on the network.

## Mac (Mac Mini M-series is excellent)

Download the **[PoH-Miner.app](https://miner.proofofhuman.ge)** — Ollama installs automatically on first launch.

Or from terminal:
```bash
curl -fsSL https://miner.proofofhuman.ge/scripts/easy-start.sh | bash
```

## Linux / Raspberry Pi / VPS

```bash
curl -fsSL https://miner.proofofhuman.ge/scripts/easy-start.sh | bash
```

Ollama installs automatically. On ARM (Pi) or no-GPU machines it runs in CPU mode.

## Geographic Advantage

Once running, the miner automatically measures its latency to the world.

Jobs from nearby regions will naturally be more attractive for you to compete on (you'll see them earlier and finish faster).

This is fair and creates better user experience globally.
