#!/usr/bin/env node
/**
 * Standalone HyperDHT bootstrap node.
 *
 * A bootstrap node is only a first-contact point: a joining node asks it for
 * neighbours, then talks to the network directly. It is never in the data path,
 * so it carries no user traffic and holds no keys. Running our own means the
 * network does not depend on Holepunch's default three.
 *
 * Requires a PUBLIC IPv4 address and an open UDP port — it must be dialable to
 * be useful, which is exactly why it lives on a VPS rather than a home machine.
 *
 * Usage:
 *   node scripts/dht-bootstrap.mjs --host <public-ipv4> [--port 49737]
 */
import HyperDHT from 'hyperdht';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const host = arg('--host', process.env.DHT_BOOTSTRAP_HOST);
const port = parseInt(arg('--port', process.env.DHT_BOOTSTRAP_PORT || '49737'), 10);

if (!host) {
  console.error('--host <public-ipv4> is required (a bootstrap node must be publicly dialable)');
  process.exit(2);
}

// IMPORTANT: DHT.bootstrapper() defaults to bootstrap:[] — an island of one.
// Left that way, nodes pointed at us would join a DHT that contains only each
// other and could never find peers that use the public network, silently
// splitting the swarm in two. So by default we also join the public DHT, which
// makes this an ADDITIONAL entry point rather than a separate network.
//
// --isolated opts out, for deliberately running a private DHT. Every node must
// then be configured with these bootstrap nodes and no others.
const isolated = argv.includes('--isolated');
const dht = HyperDHT.bootstrapper(port, host, isolated ? {} : { bootstrap: HyperDHT.BOOTSTRAP });
await dht.ready();

console.log(`[DHT-Bootstrap] Listening on ${host}:${port} (UDP)`);
console.log(isolated
  ? '[DHT-Bootstrap] ISOLATED — private DHT. Every node must use only these bootstrap nodes.'
  : '[DHT-Bootstrap] Joined the public DHT — an additional entry point, not a separate network.');
console.log('[DHT-Bootstrap] Add to a miner config as:');
console.log(`    "dhtBootstrap": ["${host}@<hostname>:${port}"]`);

setInterval(() => {
  console.log(`[DHT-Bootstrap] routing table: ${dht.toArray().length} node(s)`);
}, 10 * 60 * 1000).unref?.();

const shutdown = async () => { try { await dht.destroy(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
