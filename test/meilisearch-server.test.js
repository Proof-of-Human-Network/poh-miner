import { describe, it, expect } from 'vitest';
import { resolveMeilisearchUrl } from '../src/search/meilisearch-server.js';

describe('meilisearch-server', () => {
  it('resolves host URL from port and bindHost', () => {
    expect(resolveMeilisearchUrl({ port: 7700, bindHost: '127.0.0.1' })).toBe('http://127.0.0.1:7700');
    expect(resolveMeilisearchUrl({ host: 'http://10.0.0.1:7700/' })).toBe('http://10.0.0.1:7700');
  });
});