# PoH Miner Network - Quick Start for Bitcoin Miners

This is the **base layer** software you run to participate in the decentralized Proof-of-Work network that powers POH.

## What You Earn
- POH tokens for every block you help produce
- POH tokens + fees for being the fastest correct responder on scan/verdict requests (first-come-first-serve)

## Hardware Requirements
- A companion device (Raspberry Pi 5 8GB recommended minimum for small models)
- Internet connection
- Reliable always-on hardware with good uptime and preferably cheap power/electricity

## Run It

```bash
git clone <repo> poh-miner-network
cd poh-miner-network

# Easiest for developers / after fresh clone:
cp config.example.json config.json
# Edit config.json → set your wallet + bootnodes

npm install
npm start
```

Alternative (global config, same as installed users):
```bash
poh-miner init
# Then edit ~/.poh-miner/config.json (or the local one created)
```

The node will:
1. Sync the PoH chain
2. Advertise that it can compute verdicts using the real POH brain
3. Compete on incoming scan requests
4. Attempt to produce blocks

## Integration with Existing POH App

The old `dev/` folder becomes the **workload**.
When this miner node receives a scan request, it will (in the near future) directly call the existing `checker` and `brain` code instead of simulating it.

This way all the years of signal development, brain training, and logic are reused as the actual Proof-of-Work.
