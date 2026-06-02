/**
 * Latency & Geographic utilities for the PoH Miner Network
 *
 * Miners use this to understand their position in the world
 * relative to incoming jobs.
 */

const ANCHOR_POINTS = [
  { name: 'us-east',   lat: 39.0,  lon: -77.0  },
  { name: 'us-west',   lat: 37.4,  lon: -122.0 },
  { name: 'europe',    lat: 52.5,  lon: 13.4   },
  { name: 'singapore', lat: 1.35,  lon: 103.8  },
  { name: 'georgia',   lat: 41.7,  lon: 44.8   }, // Tbilisi as example
];

export function estimateLatencyToRegion(myLocation, targetLocation) {
  if (!myLocation || !targetLocation) return null;

  // Very rough distance-based latency estimate (real version would do actual pings)
  const R = 6371; // km
  const dLat = ((targetLocation.lat - myLocation.lat) * Math.PI) / 180;
  const dLon = ((targetLocation.lon - myLocation.lon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((myLocation.lat * Math.PI) / 180) *
      Math.cos((targetLocation.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;

  // Very rough model: ~1ms per 100km + base latency
  const base = 15;
  const variable = Math.max(5, Math.round(distanceKm / 80));
  return base + variable;
}

export async function measureLatencyToAnchors() {
  // In production this would do real TCP/HTTP pings to the anchors
  // For now we return simulated but realistic values
  const results = {};
  for (const anchor of ANCHOR_POINTS) {
    // Simulate different latencies depending on where the miner is
    results[anchor.name] = 30 + Math.random() * 180;
  }
  return results;
}

export function getMyApproximateRegion(latencyMap) {
  // Pick the anchor we have the lowest latency to
  let best = 'unknown';
  let bestLatency = Infinity;

  for (const [region, latency] of Object.entries(latencyMap)) {
    if (latency < bestLatency) {
      bestLatency = latency;
      best = region;
    }
  }
  return { region: best, latency: Math.round(bestLatency) };
}
