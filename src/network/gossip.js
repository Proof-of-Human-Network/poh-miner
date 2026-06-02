/**
 * Very simple gossip / message bus for the PoH Miner Network (MVP)
 *
 * In production this would be replaced with:
 * - libp2p + gossipsub
 * - NATS
 * - or a custom UDP/TCP mesh between miner nodes
 */

export class SimpleGossip {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.listeners = new Map(); // topic -> [handlers]
    console.log(`[Gossip] Initialized for ${nodeId}`);
  }

  subscribe(topic, handler) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, []);
    this.listeners.get(topic).push(handler);
  }

  publish(topic, message) {
    // In real impl: broadcast to peers
    console.log(`[Gossip] Publishing to ${topic}:`, typeof message === 'object' ? message.id || 'msg' : message);
    
    // Simulate local delivery for MVP
    const handlers = this.listeners.get(topic) || [];
    handlers.forEach(h => {
      try { h(message, this.nodeId); } catch (e) {}
    });
  }
}
