#!/usr/bin/env bash
# Reset ONE node's chain state for a genesis migration.
# - Backs up (tar) every target before removing.
# - DRY-RUN by default: prints what it would do. Pass --apply to actually delete.
# - NEVER touches wallets / keys / config (those are preserved).
#
# Usage:
#   reset-node.sh --role bootnode --home /root [--apply] [--backup-dir /root/genesis-backup]
#   reset-node.sh --role miner    --home /root [--apply] [--backup-dir /root/genesis-backup]
#
# After a successful --apply, the operator: (1) places the snapshot file, (2) sets
# the genesis source (bootnode: --genesis-snapshot / POH_GENESIS_SNAPSHOT;
# miner: config.json "genesisSnapshot": "<path>"), (3) starts the service.
# See README.md for the full multi-node sequence.
set -euo pipefail

ROLE=""; HOME_DIR="$HOME"; APPLY=0; BACKUP_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --role) ROLE="$2"; shift 2;;
    --home) HOME_DIR="$2"; shift 2;;
    --apply) APPLY=1; shift;;
    --backup-dir) BACKUP_DIR="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$ROLE" ] || { echo "--role bootnode|miner required" >&2; exit 2; }
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-$HOME_DIR/genesis-backup-$TS}"

# Targets per role. KEEP (never listed): wallets, .wallet-key, config.json,
# checkpoint-signer.json (finality key), brain/, bin/, ipfs/ (the repo binary).
case "$ROLE" in
  bootnode)
    BASE="$HOME_DIR/.poh-bootnode"
    TARGETS=( "$BASE/chain.ndjson" "$BASE/chain.json" )
    ;;
  miner)
    BASE="$HOME_DIR/.poh-miner"
    # chain + all state derived from it. ipfs_cid_cache.json is critical: a stale
    # cached CID can re-bootstrap the OLD chain after the reset.
    TARGETS=( "$BASE/chain" "$BASE/ipfs_cid_cache.json" "$BASE/meilisearch-data" \
              "$BASE/rewards" "$BASE/p2p" "$BASE/data" )
    ;;
  *) echo "role must be bootnode|miner" >&2; exit 2;;
esac

echo "── genesis reset (${ROLE}) ──"
echo "home:       $HOME_DIR"
echo "mode:       $([ $APPLY -eq 1 ] && echo APPLY || echo DRY-RUN)"
echo "backup dir: $BACKUP_DIR"
echo "preserved:  wallets/, .wallet-key, config.json$([ "$ROLE" = bootnode ] && echo ', checkpoint-signer.json'), brain/, bin/, ipfs/"
echo "targets:"
EXISTING=()
for t in "${TARGETS[@]}"; do
  if [ -e "$t" ]; then echo "  WIPE  $t ($(du -sh "$t" 2>/dev/null | cut -f1))"; EXISTING+=("$t");
  else echo "  --    $t (absent)"; fi
done

[ ${#EXISTING[@]} -gt 0 ] || { echo "nothing to wipe."; exit 0; }

if [ $APPLY -eq 0 ]; then
  echo ""
  echo "DRY-RUN — nothing removed. Re-run with --apply to back up + delete the WIPE targets."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
echo ""
echo "backing up to $BACKUP_DIR/${ROLE}-chainstate.tar.gz …"
tar -czf "$BACKUP_DIR/${ROLE}-chainstate.tar.gz" "${EXISTING[@]}" 2>/dev/null || {
  echo "backup FAILED — aborting, nothing deleted" >&2; exit 1; }
# Also snapshot config for reference (kept in place, copied for safety).
[ -f "$BASE/config.json" ] && cp "$BASE/config.json" "$BACKUP_DIR/${ROLE}-config.json.bak" || true

echo "removing targets …"
for t in "${EXISTING[@]}"; do rm -rf "$t" && echo "  removed $t"; done
echo ""
echo "✓ ${ROLE} chain state wiped (backup at $BACKUP_DIR). Next: place snapshot, set genesis source, start service."
