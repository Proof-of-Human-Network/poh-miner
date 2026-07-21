#!/usr/bin/env bash
#
# reset-chain.sh — wipe the PoH chain on hk (bootnode+miner) + local, and relaunch
# from block 0. Optionally mints a BRAND-NEW genesis (new timestamp → new hash →
# re-pin) so every node still on the old genesis is genesis-mismatch-rejected.
#
# Usage:
#   ./scripts/reset-chain.sh                 # reset to the CURRENT pinned genesis
#   ./scripts/reset-chain.sh --new-genesis   # new genesis at today 00:00 UTC
#   ./scripts/reset-chain.sh --new-genesis <epoch_ms>   # new genesis at a specific ms
#   ./scripts/reset-chain.sh --yes           # skip the confirmation prompt
#
# Run from the node dir:  cd ~/Desktop/poh/dev/miner/node && ./scripts/reset-chain.sh --new-genesis
#
# Assumptions (see memory project_genesis_reset_0721):
#   - hk bootnode = pm2 'poh-bootnode', args include --genesis-snapshot=/root/genesis-snapshot.json
#   - hk miner    = pm2 'poh-miner', cwd /root/poh-miner, reads /root/poh-miner/config.json
#   - miner must sync via localhost:8080 (public URL hairpins on hk)

set -euo pipefail

HK=hk
NODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP="$NODE_DIR/src/consensus/genesis-snapshot.json"
GENJS="$NODE_DIR/src/consensus/genesis.js"

NEW_GENESIS=""
YES=0
for a in "$@"; do
  case "$a" in
    --new-genesis) NEW_GENESIS="today" ;;
    --yes) YES=1 ;;
    [0-9]*) NEW_GENESIS="$a" ;;   # explicit epoch ms
  esac
done

cd "$NODE_DIR"

# ── 1. Optional: mint a brand-new genesis ────────────────────────────────────
if [ -n "$NEW_GENESIS" ]; then
  if [ "$NEW_GENESIS" = "today" ]; then
    TS=$(node -e 'const d=new Date();console.log(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()))')
  else
    TS="$NEW_GENESIS"
  fi
  ISO=$(node -e "console.log(new Date($TS).toISOString())")
  echo "🌱 New genesis timestamp: $TS ($ISO)"
  node -e "
    const fs=require('fs');
    const s=JSON.parse(fs.readFileSync('$SNAP','utf8'));
    s.balances={}; s.genesisTimestamp=$TS; s.snapshotHash=null;
    s.note='Fresh chain '+'$ISO'.slice(0,10)+' — new genesis, all balances 0, POH earned by mining from block 1.';
    s.generatedAt='$ISO';
    fs.writeFileSync('$SNAP', JSON.stringify(s,null,2)+'\n');
  "
  NEWHASH=$(node -e "import('./src/consensus/genesis.js').then(g=>console.log(g.createGenesisBlock({snapshot:g.defaultMigrationSnapshot(),difficulty:3}).genesis.getHashSync()))")
  echo "🌱 New genesis hash: $NEWHASH"
  node -e "
    const fs=require('fs');
    let t=fs.readFileSync('$GENJS','utf8');
    t=t.replace(/EXPECTED_GENESIS_HASH = '[a-f0-9]*'/, \"EXPECTED_GENESIS_HASH = '$NEWHASH'\");
    fs.writeFileSync('$GENJS', t);
  "
fi

PIN=$(grep -oE "EXPECTED_GENESIS_HASH = '[a-f0-9]+'" "$GENJS" | grep -oE "[a-f0-9]{64}")
# sanity: pinned hash must reproduce from the snapshot
COMPUTED=$(node -e "import('./src/consensus/genesis.js').then(g=>console.log(g.createGenesisBlock({snapshot:g.defaultMigrationSnapshot(),difficulty:3}).genesis.getHashSync()))")
[ "$PIN" = "$COMPUTED" ] || { echo "❌ pin ($PIN) != computed genesis ($COMPUTED) — aborting"; exit 1; }
echo "✅ Target genesis: $PIN"

# ── 2. Confirm ───────────────────────────────────────────────────────────────
if [ "$YES" -ne 1 ]; then
  echo "⚠️  This WIPES the chain + wallets on hk AND local, then relaunches from block 0."
  read -r -p "Type RESET to proceed: " ans
  [ "$ans" = "RESET" ] || { echo "aborted"; exit 1; }
fi

# ── 3. Stop services + back up + wipe ────────────────────────────────────────
echo "⏹  Stopping hk services…"
ssh "$HK" 'pm2 stop poh-bootnode poh-miner >/dev/null 2>&1 || true'

echo "💾 Backing up + wiping hk data dirs…"
ssh "$HK" 'TS=$(date +%s); mkdir -p /root/poh-reset-bak-$TS;
  tar czf /root/poh-reset-bak-$TS/keys.tar.gz -C /root .poh-miner/.wallet-key .poh-miner/wallets .poh-bootnode/checkpoint-signer.json 2>/dev/null || true;
  rm -rf /root/.poh-bootnode /root/.poh-miner; echo "  hk wiped (backup: /root/poh-reset-bak-$TS)"'

echo "💾 Backing up + wiping local data dirs…"
TS=$(date +%s); mkdir -p "$HOME/poh-reset-bak-$TS"
tar czf "$HOME/poh-reset-bak-$TS/keys.tar.gz" -C "$HOME" .poh-miner/.wallet-key .poh-miner/wallets 2>/dev/null || true
rm -rf "$HOME/.poh-miner" "$HOME/.poh-bootnode"
echo "  local wiped (backup: $HOME/poh-reset-bak-$TS)"

# ── 4. Deploy genesis files to hk ────────────────────────────────────────────
echo "📤 Deploying genesis snapshot + genesis.js to hk…"
scp -q "$SNAP"  "$HK:/root/poh-miner/src/consensus/genesis-snapshot.json"
scp -q "$SNAP"  "$HK:/root/genesis-snapshot.json"
scp -q "$GENJS" "$HK:/root/poh-miner/src/consensus/genesis.js"

# ── 5. Start bootnode → genesis at height 0 ──────────────────────────────────
echo "🚀 Starting bootnode…"
ssh "$HK" 'pm2 restart poh-bootnode --update-env >/dev/null 2>&1; sleep 6
  echo -n "  bootnode tip: "; curl -s localhost:8080/chain/tip
  echo; pm2 logs poh-bootnode --lines 20 --nostream 2>/dev/null | grep -i "New genesis hash" | tail -1 || true'

# ── 6. Fix miner config + start ──────────────────────────────────────────────
echo "🔧 Patching miner config (localhost bootnode, no stale snapshot)…"
ssh "$HK" 'node -e "
  const fs=require(\"fs\"),p=\"/root/poh-miner/config.json\";
  const c=JSON.parse(fs.readFileSync(p,\"utf8\"));
  c.bootnodes=[\"http://127.0.0.1:8080\"]; c.publicHost=\"miner.proofofhuman.ge\";
  delete c.genesisSnapshot;
  fs.writeFileSync(p, JSON.stringify(c,null,2));
"'
echo "🚀 Starting miner…"
ssh "$HK" 'pm2 restart poh-miner --update-env >/dev/null 2>&1; sleep 18
  pm2 logs poh-miner --lines 60 --nostream 2>/dev/null | grep -E "Genesis hash verified|Synced to height|Ignoring IPFS" | tail -4 || true'

# ── 7. Verify ────────────────────────────────────────────────────────────────
echo "🔎 Final state:"
ssh "$HK" 'echo -n "  bootnode height: "; curl -s localhost:8080/chain/tip | node -e "console.log(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")).height)";
  echo -n "  miner height:    "; tail -1 /root/.poh-miner/chain/chain.ndjson | node -e "console.log(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")).height)"'
echo "✅ Done. New chain live on genesis $PIN"
echo "   NOTE: commit src/consensus/genesis.js + genesis-snapshot.json; rebuild the Electron app so downloaded miners ship the new pin."
