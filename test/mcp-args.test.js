import { describe, it, expect } from 'vitest';
import { buildMcpArgs } from '../src/ai/task-cascade.js';

/**
 * Blind MCP calls used to spray the whole user message into { query, message, q }
 * whatever the tool declared, so a tool with none of those keys was called and
 * rejected — the work was wasted twice, once on a peer and again on the local
 * fallback.
 */
describe('buildMcpArgs', () => {
  const schema = (props) => ({ inputSchema: { properties: props } });

  it('fills only the declared text field, not three synonyms', () => {
    expect(buildMcpArgs(schema({ query: {}, limit: {} }), 'astana weather'))
      .toEqual({ query: 'astana weather' });
  });

  it('refuses a tool with no text-shaped input', () => {
    // onion-search__fetch_pages takes only `indexes`; calling it blind produced
    // "indexes required" every time.
    expect(buildMcpArgs(schema({ indexes: {} }), 'anything')).toBeNull();
  });

  it('picks the first matching key by preference order', () => {
    // `query` outranks `message` so a tool offering both gets the canonical one.
    expect(buildMcpArgs(schema({ message: {}, query: {} }), 'hi')).toEqual({ query: 'hi' });
    expect(buildMcpArgs(schema({ keyword: {} }), 'hi')).toEqual({ keyword: 'hi' });
  });

  it('falls back to the generic shape when no schema is published', () => {
    // Better to try than to refuse a tool that never declared its inputs.
    expect(buildMcpArgs({}, 'hi')).toEqual({ query: 'hi', message: 'hi', q: 'hi' });
    expect(buildMcpArgs(schema({}), 'hi')).toEqual({ query: 'hi', message: 'hi', q: 'hi' });
    expect(buildMcpArgs(null, 'hi')).toEqual({ query: 'hi', message: 'hi', q: 'hi' });
  });

  it('does not treat a non-text field as fillable', () => {
    expect(buildMcpArgs(schema({ latitude: {}, longitude: {} }), 'astana')).toBeNull();
  });

  it('ignores inherited object keys rather than matching Object.prototype', () => {
    expect(buildMcpArgs(schema({ constructor: {} }), 'hi')).toBeNull();
  });
});
