# Job Queue & Geographic Routing

This document explains how the PoH Miner Network intelligently routes work using a global job mempool + latency awareness.

## Core Idea

When a user requests a digital identity scan (verdict), the request enters a **global job mempool** visible to all miners.

Miners do **not** blindly compete on every job. Instead, they score each job based on:

- Fee size
- Their estimated latency to the requester
- Current load on their node
- Geographic proximity (same region = big bonus)

## Geographic Preference

Jobs carry an `originRegion` (e.g. `georgia`, `singapore`, `us-east`).

A miner in Georgia will see a much higher attractiveness score for a job originating in Georgia than a miner in Singapore will.

This creates several desirable properties:
- Better response times for users
- Natural geographic distribution of compute
- Reward fairness (local nodes aren't disadvantaged by distance)

## How Miners Decide

On startup, every miner measures latency to global anchor points and determines its approximate region.

When new jobs are gossiped, each miner runs:

```js
score = fee × geoMultiplier × loadPenalty
```

Where `geoMultiplier` can be as high as **2.2×** for same-region jobs.

## Current Implementation Status

- Full `JobQueue` with origin-aware scoring
- Automatic latency profiling on miner startup
- Demo showing 3x+ advantage for local miners

## Future Work

- Persistent job mempool (survives restarts)
- Real gossip broadcasting of new jobs
- Ability for the app layer (proofofhuman.ge) to tag jobs with origin region
- Staking-weighted reputation affecting job eligibility

This system is one of the key innovations that makes running a PoH miner economically rational and fair.
