# PoH Miner Network - Windows Installer (PowerShell)
# Supports IPFS as primary source + GitHub fallback
#
# Usage (recommended):
#   irm https://ipfs.io/ipfs/<CID>/installers/install-windows.ps1 | iex

param(
    [string]$IPFSCid = "QmReplaceWithActualCID"
)

$IPFSGateways = @(
    "https://ipfs.io/ipfs/$IPFSCid",
    "https://gateway.pinata.cloud/ipfs/$IPFSCid",
    "https://cloudflare-ipfs.com/ipfs/$IPFSCid"
)
$GITHUB_RAW = "https://raw.githubusercontent.com/poh/poh-miner-network/main"

Write-Host "PoH Miner Network - Windows Setup" -ForegroundColor Cyan
Write-Host ""

function Download-File {
    param([string]$Path, [string]$Destination)
    
    Write-Host "→ Downloading $Path ..."
    
    # Try IPFS first
    if ($IPFSCid -and $IPFSCid -ne "QmReplaceWithActualCID") {
        foreach ($gateway in $IPFSGateways) {
            try {
                Invoke-WebRequest -Uri "$gateway/$Path" -OutFile $Destination -UseBasicParsing -ErrorAction Stop
                Write-Host "   ✓ Downloaded from IPFS"
                return $true
            } catch {}
        }
        Write-Host "   IPFS gateways failed, trying GitHub..."
    }
    
    # Fallback to GitHub
    try {
        Invoke-WebRequest -Uri "$GITHUB_RAW/$Path" -OutFile $Destination -UseBasicParsing -ErrorAction Stop
        Write-Host "   ✓ Downloaded from GitHub"
        return $true
    } catch {
        Write-Host "❌ Failed to download $Path"
        return $false
    }
}

$InstallDir = "$env:USERPROFILE\.poh-miner"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# 1. Install Ollama if missing
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "→ Installing Ollama..."
    Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile "$env:TEMP\OllamaSetup.exe"
    Start-Process -FilePath "$env:TEMP\OllamaSetup.exe" -Wait
} else {
    Write-Host "✓ Ollama already installed"
}

# 2. Pull a good default model
Write-Host "→ Pulling recommended model..."
ollama pull qwen2.5:1.5b

# 3. Download main installer script (so future updates come from IPFS too)
Download-File -Path "scripts/easy-start.sh" -Destination "$InstallDir\easy-start.sh"

# 4. Create simple launcher
$Launcher = @"
@echo off
cd /d "%~dp0"
echo Starting PoH Miner...
node src\cli.js start
pause
"@
$Launcher | Out-File -FilePath "$InstallDir\start.bat" -Encoding ASCII

Write-Host ""
Write-Host "✅ Setup complete!"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Edit $InstallDir\config.json and set your Solana wallet"
Write-Host "  2. VERY IMPORTANT: Also add your solanaRpc and at least one EVM rpc in rpcEndpoints"
Write-Host "     Many signals will not work without proper RPC keys."
Write-Host "  3. Run: $InstallDir\start.bat"
Write-Host ""
Write-Host "To force CPU mode (no GPU), edit config.json and set:"
Write-Host '  "inferenceMode": "cpu"'
