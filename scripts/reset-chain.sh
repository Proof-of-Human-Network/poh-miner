#!/usr/bin/env bash
#
# reset-chain.sh — wipe the DAI chain on hk (bootnode+miner) + local, and relaunch
# from block 0. Optionally mints a BRAND-NEW genesis (new timestamp → new hash →
# re-pin) so every node still on the old genesis is genesis-mismatch-rejected.
#
# Usage:
#   ./scripts/reset-chain.sh                 # reset to the CURRENT pinned genesis
#   ./scripts/reset-chain.sh --new-genesis   # new genesis at today 00:00 UTC
#   ./scripts/reset-chain.sh --new-genesis <epoch_ms>   # new genesis at a specific ms
#   ./scripts/reset-chain.sh --yes           # skip the confirmation prompt
#
# Run from the node dir:  cd ~/Desktop/dai/dev/miner/node && ./scripts/reset-chain.sh --new-genesis
#
# Assumptions (see memory project_genesis_reset_0721):
#   - hk bootnode = pm2 'dai-bootnode', args include --genesis-snapshot=/root/genesis-snapshot.json
#   - hk miner    = pm2 'dai-miner', cwd /root/dai-miner, reads /root/dai-miner/config.json
#   - miner must sync via localhost:8080 (public URL hairpins on hk)

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# DO NOT USE. Superseded by scripts/genesis/reset-node.sh.
#
# This script `rm -rf`s /root/.dai-miner and /root/.dai-bootnode wholesale. It
# tars the keys to a backup first but NEVER RESTORES THEM, so the node comes
# back with a brand-new identity and every migrated balance becomes unspendable
# -- the genesis snapshot preserves balances by address, and the keys to those
# addresses would be sitting in a tarball.
#
# Its pm2 names and paths are also stale: it targets dai-bootnode/dai-miner at
# /root/dai-miner, while hk runs poh-bootnode/poh-miner at /root/poh-miner.
#
# reset-node.sh does the same job surgically: dry-run by default, backs up each
# target, and explicitly preserves wallets/, .wallet-key and config.json.
#
# Note --new-genesis here also sets balances={}, which is a FRESH chain, not the
# balance migration. For a migration use:
#   node scripts/genesis/export-snapshot.mjs --data-dir <dir> --mint-stables
# ─────────────────────────────────────────────────────────────────────────────
if [ "${I_UNDERSTAND_THIS_DESTROYS_WALLET_KEYS:-}" != "yes" ]; then
  echo "refusing to run: this script destroys wallet keys (see header)." >&2
  echo "use scripts/genesis/reset-node.sh instead." >&2
  exit 1
fi

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
    s.note='Fresh chain '+'$ISO'.slice(0,10)+' — new genesis, all balances 0, DAI earned by mining from block 1.';
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
ssh "$HK" 'pm2 stop dai-bootnode dai-miner >/dev/null 2>&1 || true'

echo "💾 Backing up + wiping hk data dirs…"
ssh "$HK" 'TS=$(date +%s); mkdir -p /root/dai-reset-bak-$TS;
  tar czf /root/dai-reset-bak-$TS/keys.tar.gz -C /root .dai-miner/.wallet-key .dai-miner/wallets .dai-bootnode/checkpoint-signer.json 2>/dev/null || true;
  rm -rf /root/.dai-bootnode /root/.dai-miner; echo "  hk wiped (backup: /root/dai-reset-bak-$TS)"'

echo "💾 Backing up + wiping local data dirs…"
TS=$(date +%s); mkdir -p "$HOME/dai-reset-bak-$TS"
tar czf "$HOME/dai-reset-bak-$TS/keys.tar.gz" -C "$HOME" .dai-miner/.wallet-key .dai-miner/wallets 2>/dev/null || true
rm -rf "$HOME/.dai-miner" "$HOME/.dai-bootnode"
echo "  local wiped (backup: $HOME/dai-reset-bak-$TS)"

# ── 4. Deploy genesis files to hk ────────────────────────────────────────────
echo "📤 Deploying genesis snapshot + genesis.js to hk…"
scp -q "$SNAP"  "$HK:/root/dai-miner/src/consensus/genesis-snapshot.json"
scp -q "$SNAP"  "$HK:/root/genesis-snapshot.json"
scp -q "$GENJS" "$HK:/root/dai-miner/src/consensus/genesis.js"

# ── 5. Start bootnode → genesis at height 0 ──────────────────────────────────
echo "🚀 Starting bootnode…"
ssh "$HK" 'pm2 restart dai-bootnode --update-env >/dev/null 2>&1; sleep 6
  echo -n "  bootnode tip: "; curl -s localhost:8080/chain/tip
  echo; pm2 logs dai-bootnode --lines 20 --nostream 2>/dev/null | grep -i "New genesis hash" | tail -1 || true'

# ── 6. Fix miner config + start ──────────────────────────────────────────────
echo "🔧 Patching miner config (localhost bootnode, no stale snapshot)…"
ssh "$HK" 'node -e "
  const fs=require(\"fs\"),p=\"/root/dai-miner/config.json\";
  const c=JSON.parse(fs.readFileSync(p,\"utf8\"));
  c.bootnodes=[\"http://127.0.0.1:8080\"]; c.publicHost=\"miner.iamai.kg\";
  delete c.genesisSnapshot;
  fs.writeFileSync(p, JSON.stringify(c,null,2));
"'
echo "🚀 Starting miner…"
ssh "$HK" 'pm2 restart dai-miner --update-env >/dev/null 2>&1; sleep 18
  pm2 logs dai-miner --lines 60 --nostream 2>/dev/null | grep -E "Genesis hash verified|Synced to height|Ignoring IPFS" | tail -4 || true'

# ── 7. Verify ────────────────────────────────────────────────────────────────
echo "🔎 Final state:"
ssh "$HK" 'echo -n "  bootnode height: "; curl -s localhost:8080/chain/tip | node -e "console.log(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")).height)";
  echo -n "  miner height:    "; tail -1 /root/.dai-miner/chain/chain.ndjson | node -e "console.log(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")).height)"'
echo "✅ Done. New chain live on genesis $PIN"
echo "   NOTE: commit src/consensus/genesis.js + genesis-snapshot.json; rebuild the Electron app so downloaded miners ship the new pin."
