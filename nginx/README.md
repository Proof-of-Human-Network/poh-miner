# Nginx Configurations for PoH Miner Network

This folder contains production-ready Nginx configurations for the public domains.

## Folder Structure

```
nginx/
├── README.md
├── sites-available/
│   ├── bootnode.proofofhuman.ge.conf
│   ├── miner.proofofhuman.ge.conf          # Recommended: serves landing + proxies /api
│   └── miner.proofofhuman.ge.proxy.conf    # Alternative: full proxy to port 3456
├── sites-enabled/                          # Symlinks for easy enabling
│   ├── bootnode.proofofhuman.ge.conf → ../sites-available/...
│   └── miner.proofofhuman.ge.conf → ../sites-available/...
└── snippets/                               # Reusable configuration blocks
    ├── rate-limiting.conf
    ├── security-headers.conf
    └── ssl-params.conf
```

## Domains

| Domain                      | IP Address      | SSH Alias   | Purpose                              | Backend Port |
|----------------------------|------------------|-------------|--------------------------------------|--------------|
| bootnode.proofofhuman.ge   | 217.60.38.159   | `hk`        | PoH Bootnode HTTP API                | 8080         |
| miner.proofofhuman.ge      | 95.182.101.171  | `exchange`  | Landing page + Miner Wallet API      | 3456         |

## Recommended Setup

### For `bootnode.proofofhuman.ge`
- Uses rate limiting (important for public bootnodes)
- Proxies to the bootnode running on port 8080

### For `miner.proofofhuman.ge` (Recommended)
- Serves the static `landing/` folder
- Proxies API calls (`/api/*`, `/wallet`, `/chain`, etc.) to the miner node on port 3456

Use `miner.proofofhuman.ge.proxy.conf` only if you prefer to proxy *everything* to the miner node.

## Deployment

### 1. Copy to servers

```bash
# Bootnode server
scp -r nginx/sites-available/bootnode.proofofhuman.ge.conf root@217.60.38.159:/etc/nginx/sites-available/
scp -r nginx/snippets/ root@217.60.38.159:/etc/nginx/

# Miner server
scp -r nginx/sites-available/miner.proofofhuman.ge.conf root@95.182.101.171:/etc/nginx/sites-available/
scp -r nginx/snippets/ root@95.182.101.171:/etc/nginx/
```

### 2. Enable sites

```bash
# On each server
ln -s /etc/nginx/sites-available/bootnode.proofofhuman.ge.conf /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/miner.proofofhuman.ge.conf /etc/nginx/sites-enabled/
```

### 3. Obtain SSL certificates

```bash
# On bootnode server (hk)
certbot --nginx -d bootnode.proofofhuman.ge

# On miner server (exchange)
certbot --nginx -d miner.proofofhuman.ge
```

### 4. Test & reload

```bash
nginx -t && systemctl reload nginx
```

## Important Notes

- Make sure the static landing page is deployed to `/var/www/miner.proofofhuman.ge` on the miner server if using the recommended config.
- The bootnode config includes rate limiting. Adjust `rate-limiting.conf` as needed.
- After changing snippets, always run `nginx -t` before reloading.

## SSH Config Recommendation

Add this to your `~/.ssh/config` for convenience:

```ssh-config
Host hk
    HostName 217.60.38.159
    User root

Host exchange
    HostName 95.182.101.171
    User root
```

## Bootnode Deployment

Use the deployment script from the project root:

```bash
./scripts/deploy-bootnode.sh
```

This script will:
- Rsync only the required source files (`src/bootnode.js`, `src/core/`, `src/storage/`) to `/opt/poh-bootnode` on the `hk` server
- Install Node.js (if missing) via NodeSource
- Install and enable the `poh-bootnode` systemd service
- Restart the service

### Manual steps (if needed)

1. On the bootnode server (`hk`):

```bash
sudo mkdir -p /opt/poh-bootnode /var/lib/poh-bootnode
sudo chown -R $USER:$USER /var/lib/poh-bootnode
```

2. Deploy files (from your local machine):

```bash
rsync -avz --delete \
  --exclude node_modules --exclude .git --exclude dist \
  --include 'src/bootnode.js' \
  --include 'src/core/**' \
  --include 'src/storage/**' \
  --include 'package.json' \
  --exclude '*' \
  . hk:/opt/poh-bootnode/
```

3. On the server, create the systemd service (see `systemd/poh-bootnode.service` in this repo).

4. Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now poh-bootnode
sudo journalctl -u poh-bootnode -f
```

The bootnode will be available at `https://bootnode.proofofhuman.ge` once Nginx is configured.
