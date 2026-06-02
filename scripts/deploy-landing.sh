#!/usr/bin/env bash
#
# deploy-landing.sh
#
# Quickly deploys the landing page (and assets) to the production server via rsync
# over the 'poh' SSH alias defined in ~/.ssh/config (see: 31.57.118.167 root).
#
# Usage:
#   ./scripts/deploy-landing.sh
#   ./scripts/deploy-landing.sh --dry-run
#   REMOTE_PATH=/var/www/html/ ./scripts/deploy-landing.sh
#

set -e

REMOTE_HOST="poh"
REMOTE_PATH="${REMOTE_PATH:-/var/www/poh-miner/}"

LOCAL_LANDING_DIR="landing"

if [ ! -d "$LOCAL_LANDING_DIR" ]; then
    echo "❌ Error: '$LOCAL_LANDING_DIR' directory not found. Run from poh-miner-network root."
    exit 1
fi

echo "🚀 Deploying landing to $REMOTE_HOST:$REMOTE_PATH"
echo "   Local: $LOCAL_LANDING_DIR/"
echo "   (Using SSH config for poh → $(grep -A1 '^Host poh' ~/.ssh/config 2>/dev/null | tail -1 | awk '{print $2}' || echo '31.57.118.167'))"
echo ""

# Quick connectivity check (skip for dry-run so it can be tested offline)
if [ "$1" != "--dry-run" ]; then
  if ! ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new "$REMOTE_HOST" 'echo pong' >/dev/null 2>&1; then
      echo "⚠️  Cannot connect to '$REMOTE_HOST' via SSH."
      echo "   Check: ssh poh   (and your ~/.ssh/id_ed25519)"
      echo "   Or: ssh root@31.57.118.167"
      exit 1
  fi
fi

if [ "$1" = "--dry-run" ]; then
    echo "=== DRY RUN (no changes) ==="
    rsync -avz --delete --dry-run --progress "$LOCAL_LANDING_DIR/" "$REMOTE_HOST:$REMOTE_PATH"
    echo "=== END DRY RUN ==="
else
    rsync -avz --delete --progress "$LOCAL_LANDING_DIR/" "$REMOTE_HOST:$REMOTE_PATH"
    echo ""
    echo "✅ Landing page published successfully to $REMOTE_HOST:$REMOTE_PATH"
    echo ""
    echo "   Next steps on server (example for nginx):"
    echo "     ssh poh"
    echo "     # ln -s $REMOTE_PATH /var/www/poh-landing  (or configure server block)"
    echo "     # systemctl reload nginx"
    echo ""
    echo "   Public URL will be whatever domain / IP you have pointing at the server."
fi
