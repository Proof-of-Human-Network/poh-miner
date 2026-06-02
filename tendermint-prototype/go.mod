module github.com/poh/poh-miner-network/tendermint-prototype

go 1.21

// For a real implementation we would depend on:
// github.com/cometbft/cometbft v0.38.x (or Tendermint)
// github.com/cosmos/cosmos-sdk (optional, for richer modules)
// 
// Post-quantum crypto libraries:
// github.com/cloudflare/circl (has Dilithium)
// or specific post-quantum signature crates if using Rust