#!/usr/bin/env bash
#
# deploy-bootnode.sh
#
# Deploys the PoH Bootnode to the production server (miner.proofofhuman.ge)
#
# SSH alias: hk (217.60.38.159)
#
# Usage (recommended - key-based auth):
#   ./scripts/deploy-bootnode.sh
#   ./scripts/deploy-bootnode.sh --dry-run
#
# Usage with password (requires sshpass):
#   SSH_PASSWORD='YourPasswordHere' ./scripts/deploy-bootnode.sh
#   SSH_PASSWORD='YourPasswordHere' ./scripts/deploy-bootnode.sh --dry-run
#

set -e

REMOTE_HOST="exchange"
REMOTE_HOST_IP="95.182.101.171"
REMOTE_DIR="/opt/poh-bootnode"
DATA_DIR="/var/lib/poh-bootnode"
SERVICE_NAME="poh-bootnode"

LOCAL_SRC_DIR="."

# === Password Support (via sshpass) ===
# Option 1 (recommended for scripting):
#   SSH_PASSWORD='YourPasswordHere' ./scripts/deploy-bootnode.sh
#
# Option 2 (interactive - will prompt securely):
#   ./scripts/deploy-bootnode.sh
#
# Option 3 (with dry-run):
#   SSH_PASSWORD='YourPasswordHere' ./scripts/deploy-bootnode.sh --dry-run

if [ -z "$SSH_PASSWORD" ]; then
    # If no password in env, ask interactively (hidden input)
    read -s -p "Enter SSH password for $REMOTE_HOST: " SSH_PASSWORD
    echo ""
fi

if [ -n "$SSH_PASSWORD" ]; then
    if ! command -v sshpass >/dev/null 2>&1; then
        echo "❌ sshpass is not installed, but a password is required."
        echo "   Install it first:"
        echo "     Ubuntu/Debian:  sudo apt install sshpass"
        echo "     macOS:          brew install hudochenkov/sshpass/sshpass"
        exit 1
    fi

    # Use SSHPASS environment variable (safer + more reliable than -p flag)
    export SSHPASS="$SSH_PASSWORD"

    SSH_CMD="sshpass -e ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new"
    RSYNC_SSH_CMD="sshpass -e ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new"
    echo "🔐 Using password authentication (via sshpass)"
else
    SSH_CMD="ssh"
    RSYNC_SSH_CMD="ssh"
fi

echo "🚀 Deploying PoH Bootnode to $REMOTE_HOST ($REMOTE_HOST_IP)"
echo "   Target directory: $REMOTE_DIR"
echo ""

# Check SSH connectivity
if [ "$1" != "--dry-run" ]; then
    if [ -n "$SSH_PASSWORD" ]; then
        # For password auth, run sshpass directly for the test (more reliable)
        CONNECTIVITY_CMD="sshpass -e ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8"
    else
        CONNECTIVITY_CMD="$SSH_CMD -o BatchMode=yes -o ConnectTimeout=8"
    fi

    if ! $CONNECTIVITY_CMD "$REMOTE_HOST" 'echo pong' >/dev/null 2>&1; then
        echo "❌ Cannot connect to '$REMOTE_HOST' via SSH."
        echo "   Tried with: $CONNECTIVITY_CMD"
        echo ""
        echo "   Debug tip — run this manually:"
        echo "     export SSHPASS='yourpassword'"
        echo "     sshpass -e ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no hk 'echo pong'"
        exit 1
    fi
    echo "✅ SSH connection to $REMOTE_HOST successful"
fi

echo ""
echo "📦 Syncing bootnode source files..."

# Safety check: make sure we are in the correct local directory
if [ ! -f "src/bootnode.js" ]; then
    echo "❌ Error: src/bootnode.js not found in current directory."
    echo "   You must run this script from the 'poh-miner-network' folder on your laptop."
    echo "   Example: cd ~/Desktop/poh/miner/poh-miner-network && ./scripts/deploy-bootnode.sh"
    exit 1
fi

# Rsync only the files needed for the bootnode
RSYNC_EXCLUDES="--exclude node_modules --exclude .git --exclude dist --exclude '*.log' --exclude scripts --exclude landing --exclude electron"

if [ "$1" = "--dry-run" ]; then
    echo "=== DRY RUN ==="
    rsync -avz --delete --dry-run --progress \
        -e "$RSYNC_SSH_CMD" \
        $RSYNC_EXCLUDES \
        --include 'src/bootnode.js' \
        --include 'src/core/**' \
        --include 'src/storage/**' \
        --include 'src/security/**' \
        --include 'src/wallet/**' \
        --include 'src/consensus/**' \
        --include 'package.json' \
        --exclude '*' \
        "$LOCAL_SRC_DIR/" "$REMOTE_HOST:$REMOTE_DIR/"
    echo "=== END DRY RUN ==="
    exit 0
fi

# Actual sync of minimal required files
rsync -avz --delete --progress \
    -e "$RSYNC_SSH_CMD" \
    $RSYNC_EXCLUDES \
    --include 'src/bootnode.js' \
    --include 'src/core/**' \
    --include 'src/storage/**' \
    --include 'src/security/**' \
    --include 'src/wallet/**' \
    --include 'src/consensus/**' \
    --include 'package.json' \
    --exclude '*' \
    "$LOCAL_SRC_DIR/" "$REMOTE_HOST:$REMOTE_DIR/"

echo ""
echo "🔧 Setting up bootnode on remote server..."

$SSH_CMD "$REMOTE_HOST" bash << 'REMOTE_EOF'
set -e

# Create data directory
sudo mkdir -p /var/lib/poh-bootnode
sudo chown -R $USER:$USER /var/lib/poh-bootnode

# Install Node.js if not present (Ubuntu/Debian)
if ! command -v node >/dev/null 2>&1; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node version: $(node --version)"

# Create systemd service
sudo tee /etc/systemd/system/poh-bootnode.service > /dev/null << 'SERVICE_EOF'
[Unit]
Description=PoH Miner Network Bootnode
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/poh-bootnode
ExecStart=/usr/bin/node src/bootnode.js --port 8080 --bind=127.0.0.1 --data-dir /var/lib/poh-bootnode
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=poh-bootnode

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Reload systemd and enable service
sudo systemctl daemon-reload
sudo systemctl enable poh-bootnode.service

echo "✅ Systemd service installed and enabled"
REMOTE_EOF

echo ""
echo "🔄 Restarting bootnode service on remote..."
$SSH_CMD "$REMOTE_HOST" "sudo systemctl daemon-reload && sudo systemctl restart poh-bootnode.service && sleep 2 && sudo systemctl status poh-bootnode.service --no-pager"

echo ""
echo "🔧 Deploying Nginx config for bootnode..."

# Copy nginx config + snippets to the server
if [ -f "nginx/sites-available/miner.proofofhuman.ge.conf" ]; then
    echo "   Copying nginx config and snippets..."

    # Copy snippets
    $RSYNC_SSH_CMD -o StrictHostKeyChecking=accept-new \
        nginx/snippets/ \
        "$REMOTE_HOST:/tmp/nginx-snippets/"

    $SSH_CMD "$REMOTE_HOST" 'sudo mkdir -p /etc/nginx/snippets && \
        sudo rsync -a /tmp/nginx-snippets/ /etc/nginx/snippets/ && \
        rm -rf /tmp/nginx-snippets'

    # Copy main config
    $RSYNC_SSH_CMD -o StrictHostKeyChecking=accept-new \
        nginx/sites-available/miner.proofofhuman.ge.conf \
        "$REMOTE_HOST:/tmp/miner.proofofhuman.ge.conf"

    $SSH_CMD "$REMOTE_HOST" 'sudo mv /tmp/miner.proofofhuman.ge.conf /etc/nginx/sites-available/ && \
        sudo ln -sf /etc/nginx/sites-available/miner.proofofhuman.ge.conf /etc/nginx/sites-enabled/ && \
        nginx -t && sudo systemctl reload nginx'

    echo "✅ Nginx config + snippets deployed and enabled for miner.proofofhuman.ge"
else
    echo "⚠️  nginx/sites-available/miner.proofofhuman.ge.conf not found locally. Skipping nginx deployment."
fi

echo ""
echo "✅ Bootnode + Nginx config deployed successfully!"
echo ""
echo "Next steps:"
echo "  1. Check bootnode logs:   ssh hk 'sudo journalctl -u poh-bootnode -f'"
echo "  2. Check nginx status:    ssh hk 'sudo nginx -t && sudo systemctl reload nginx'"
echo "  3. Test the endpoint:     curl -I https://miner.proofofhuman.ge/chain/tip"
echo "  4. Nodes register (protected): miners now POST /register with signature proof; GET /peers shows verified nodes + ports for direct /job verdict queries"
echo ""
echo "If you haven't obtained the SSL certificate yet, run on the server:"
echo "  ssh hk 'sudo certbot --nginx -d miner.proofofhuman.ge'"

# Security: clear password from environment
unset SSH_PASSWORD SSHPASS 2>/dev/null || true