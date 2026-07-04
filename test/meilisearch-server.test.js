import { describe, it, expect } from 'vitest';
import net from 'net';
import {
  resolveMeilisearchUrl,
  isPortListening,
  meilisearchHealthy,
  getMeilisearchMasterKey,
} from '../src/search/meilisearch-server.js';

describe('meilisearch-server', () => {
  it('resolves host URL from port and bindHost', () => {
    expect(resolveMeilisearchUrl({ port: 7700, bindHost: '127.0.0.1' })).toBe('http://127.0.0.1:7700');
    expect(resolveMeilisearchUrl({ host: 'http://10.0.0.1:7700/' })).toBe('http://10.0.0.1:7700');
  });

  it('detects when a TCP port is listening', async () => {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    expect(await isPortListening('127.0.0.1', port)).toBe(true);
    expect(await isPortListening('127.0.0.1', port + 1)).toBe(false);
    await new Promise(resolve => server.close(resolve));
  });

  it('reports unhealthy for unreachable host', async () => {
    expect(await meilisearchHealthy('http://127.0.0.1:1', 200)).toBe(false);
  });

  it('reads master key from config apiKey', () => {
    const key = 'a'.repeat(32);
    expect(getMeilisearchMasterKey({ apiKey: key })).toBe(key);
    expect(getMeilisearchMasterKey({ apiKey: 'short' })).toBeNull();
  });
});