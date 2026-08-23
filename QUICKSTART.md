# DAI Miner Network - Quick Start for Bitcoin Miners

This is the **base layer** software you run to participate in the decentralized Proof-of-Work network that powers DAI.

## What You Earn
- DAI for the AI work your node completes — each block's reward is split among workers **weighted by the compute they delivered** (plus a small cut to the block proposer)
- The per-job **fee** (paid by the requester) on every `skill`/`compute` job your node answers
- Idle blocks (no jobs) mint only a small keepalive, so rewards follow real demand

## Hardware Requirements
- A companion device (Raspberry Pi 5 8GB recommended minimum for small models)
- Internet connection
- Reliable always-on hardware with good uptime and preferably cheap power/electricity

## Run It

```bash
git clone <repo> dai-miner-network
cd dai-miner-network

# Easiest for developers / after fresh clone:
cp config.example.json config.json
# Edit config.json → set your wallet + bootnodes

npm install
npm start
```

Alternative (global config, same as installed users):
```bash
dai-miner init
# Then edit ~/.dai-miner/config.json (or the local one created)
```

The node will:
1. Sync the DAI chain
2. Advertise that it can compute verdicts using the real DAI brain
3. Compete on incoming scan requests
4. Attempt to produce blocks

## Integration with Existing DAI App

The old `dev/` folder becomes the **workload**.
When this miner node receives a scan request, it will (in the near future) directly call the existing `checker` and `brain` code instead of simulating it.

This way all the years of signal development, brain training, and logic are reused as the actual Proof-of-Work.
