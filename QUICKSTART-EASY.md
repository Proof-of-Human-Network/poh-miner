# Super Easy Start (Mac Mini, Windows, Linux, Pi)

We are making this as easy as possible so that **anyone** with spare compute can join.

## Windows (GUI — easiest)

1. Download **[PoH-Miner.exe](https://miner.proofofhuman.ge/binaries/poh-miner-windows-x64.exe)** and run it.
2. Nothing extra to install — inference runs in-process via QVAC.
3. Done — the model (default `qwen3-1.7b`) downloads on first use and mining starts.

Model still downloading? You can still use the miner — chat and skills fall back to peer miners on the network that already have the model.

## Mac (Mac Mini M-series is excellent)

Download the **[PoH-Miner.app](https://miner.proofofhuman.ge)** — no engine to install; the model downloads on first launch.

Or from terminal:
```bash
curl -fsSL https://miner.proofofhuman.ge/scripts/easy-start.sh | bash
```

## Linux / Raspberry Pi / VPS

```bash
curl -fsSL https://miner.proofofhuman.ge/scripts/easy-start.sh | bash
```

No engine to install — QVAC runs in-process. On ARM (Pi) or no-GPU machines it runs in CPU mode.

## Geographic Advantage

Once running, the miner automatically measures its latency to the world.

Jobs from nearby regions will naturally be more attractive for you to compete on (you'll see them earlier and finish faster).

This is fair and creates better user experience globally.
