# IPFS Distribution

This directory contains the latest CIDs for the PoH Miner Network distribution.

## Files

- `latest.txt` — Root CID of the latest published assets (scripts, docs, landing)
- `scripts.txt` — CID specifically for the installer scripts
- `binaries.txt` — CID for pre-built binaries and packages (when available)

## How it works

The `scripts/publish-to-ipfs.sh` script automatically updates these files after publishing.

After running the publish script, commit the updated `ipfs/*.txt` files.

## Recommended Gateways

- https://ipfs.io/ipfs/<CID>
- https://gateway.pinata.cloud/ipfs/<CID>
- https://cloudflare-ipfs.com/ipfs/<CID>

## Usage

### Easiest (recommended)

Use the helper script:

```bash
./scripts/download-latest.sh          # just download
./scripts/download-latest.sh --install  # download + install to ~/.local/bin
```

### One-click pre-built binaries (no terminal)

See the "Ready to contribute real compute?" section on the landing page (published to your server or via IPFS landing/index.html). Direct links:

- https://ipfs.io/ipfs/$(cat ipfs/binaries.txt)/binaries/poh-miner-linux-x64.deb
- .../poh-miner-linux-x64.AppImage
- .../poh-miner-macos-arm64
- .../poh-miner-windows-x64.exe

### Manual

### Mac / Linux

```bash
curl -fsSL https://ipfs.io/ipfs/$(cat ipfs/latest.txt)/scripts/easy-start.sh | bash
```

### Windows

```powershell
irm "https://ipfs.io/ipfs/$(Get-Content ipfs\latest.txt)\installers\install-windows.ps1" | iex
```

> Note: Replace the CID files with real values after running the publish script.
