/**
 * MCP (Model Context Protocol) client — connects the miner's LLM to external
 * MCP servers configured in config.mcpServers (standard "Claude Desktop / Cursor"
 * format). Previously config.mcpServers was saved by the GUI but never consumed;
 * this module actually launches/connects the servers, lists their tools, and
 * executes tool calls so the chat model can use them.
 *
 * Transports:
 *   - stdio: { command, args, env }  → spawns the process, speaks newline-
 *     delimited JSON-RPC 2.0 over stdin/stdout (the MCP stdio transport).
 *   - http:  { url, apiKey?, headers? } → Streamable HTTP: POST JSON-RPC,
 *     accept a JSON or single-event SSE response. `headers` is an object of
 *     extra HTTP headers (Authorization, API keys, etc.) — not limited to
 *     `Authorization: Bearer`.
 *   - builtin: native tool packs shipped with the miner (public-apis, onion-search).
 *
 * Dependency-free (no @modelcontextprotocol/sdk) — the protocol surface we need
 * (initialize → tools/list → tools/call) is small and stable.
 */

import { spawn } from 'child_process';
import { loadBuiltinPacks, listBuiltinCards } from './builtin-mcp/index.js';
import { defaultHttpSpecs, defaultHttpSeedCards } from './default-mcp-servers.js';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'dai-miner', version: '1.0' };
const REQUEST_TIMEOUT_MS = 30_000;

/** One connection to a single MCP server. */
class McpConnection {
  constructor(id, spec) {
    this.id = id;
    this.spec = spec;
    this.transport = spec.url ? 'http' : 'stdio';
    this.proc = null;
    this.tools = [];
    this.connected = false;
    this.error = null;
    this._nextId = 1;
    this._pending = new Map();   // rpcId → { resolve, reject, timer }
    this._buf = '';
    this._sessionId = null;
  }

  // ── JSON-RPC plumbing ──────────────────────────────────────────────────────
  _rpc(method, params) {
    const id = this._nextId++;
    const msg = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP ${this.id}: "${method}" timed out`));
      }, REQUEST_TIMEOUT_MS);
      this._pending.set(id, { resolve, reject, timer });
      this._send(msg).catch(err => {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      });
    });
  }

  _notify(method, params) {
    return this._send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  }

  _resolveMessage(msg) {
    if (msg.id == null || !this._pending.has(msg.id)) return; // notification / unknown
    const { resolve, reject, timer } = this._pending.get(msg.id);
    clearTimeout(timer);
    this._pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
    else resolve(msg.result);
  }

  // ── stdio transport ────────────────────────────────────────────────────────
  async _connectStdio() {
    const { command, args = [], env = {} } = this.spec;
    if (!command) throw new Error('stdio MCP server needs a "command"');
    this.proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.on('error', err => { this.error = err.message; this.connected = false; });
    this.proc.on('exit', code => {
      this.connected = false;
      if (code && !this.error) this.error = `process exited (code ${code})`;
      for (const { reject, timer } of this._pending.values()) { clearTimeout(timer); reject(new Error('MCP server exited')); }
      this._pending.clear();
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => this._onStdout(chunk));
    // stderr is diagnostic only — surface first line for debugging
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', d => { if (!this._loggedErr) { this._loggedErr = true; } });
  }

  _onStdout(chunk) {
    this._buf += chunk;
    let nl;
    while ((nl = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, nl).trim();
      this._buf = this._buf.slice(nl + 1);
      if (!line) continue;
      try { this._resolveMessage(JSON.parse(line)); } catch { /* non-JSON line — ignore */ }
    }
  }

  // ── http (Streamable HTTP) transport ───────────────────────────────────────
  async _sendHttp(msg) {
    const headers = httpHeadersFromSpec(this.spec);
    if (this._sessionId) headers['Mcp-Session-Id'] = this._sessionId;
    const res = await fetch(this.spec.url, {
      method: 'POST', headers, body: JSON.stringify(msg),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this._sessionId = sid;
    if (msg.id == null) return; // notification — no response expected
    if (!res.ok) throw new Error(`MCP ${this.id}: HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    let payload;
    if (ct.includes('text/event-stream')) {
      const text = await res.text();
      const dataLine = text.split('\n').find(l => l.startsWith('data:'));
      payload = dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
    } else {
      payload = await res.json();
    }
    if (payload) this._resolveMessage(payload);
  }

  _send(msg) {
    if (this.transport === 'http') return this._sendHttp(msg);
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin.writable) return reject(new Error('MCP server not running'));
      this.proc.stdin.write(JSON.stringify(msg) + '\n', err => (err ? reject(err) : resolve()));
    });
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  async connect() {
    try {
      if (this.transport === 'stdio') await this._connectStdio();
      await this._rpc('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      await this._notify('notifications/initialized');
      const list = await this._rpc('tools/list', {});
      this.tools = (list?.tools || []).map(t => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || t.input_schema || {},
      }));
      this.connected = true;
      this.error = null;
      return this.tools;
    } catch (err) {
      this.error = err.message;
      this.connected = false;
      this.close();
      throw err;
    }
  }

  async callTool(name, args) {
    if (!this.connected) throw new Error(`MCP ${this.id} not connected`);
    const result = await this._rpc('tools/call', { name, arguments: args || {} });
    // MCP tool results are { content: [{type:'text', text}, ...], isError? }
    const text = (result?.content || [])
      .map(c => (c.type === 'text' ? c.text : c.type === 'json' ? JSON.stringify(c.json) : ''))
      .filter(Boolean).join('\n');
    if (result?.isError) throw new Error(text || 'tool reported an error');
    return text || JSON.stringify(result?.content ?? result ?? '');
  }

  close() {
    try { this.proc?.kill(); } catch { /* already gone */ }
    this.proc = null;
    this.connected = false;
  }
}

/**
 * Build HTTP headers for an MCP connector.
 * `spec.headers` is the general case (any header name/value).
 * `spec.apiKey` still sets `Authorization: Bearer …` when Authorization is unset.
 */
export function httpHeadersFromSpec(spec = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'User-Agent': 'dai-miner/mcp',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  };
  if (spec.headers && typeof spec.headers === 'object' && !Array.isArray(spec.headers)) {
    for (const [k, v] of Object.entries(spec.headers)) {
      if (v == null || v === '') continue;
      headers[k] = String(v);
    }
  }
  const hasAuth = Object.keys(headers).some(k => k.toLowerCase() === 'authorization');
  if (spec.apiKey && !hasAuth) headers['Authorization'] = `Bearer ${spec.apiKey}`;
  return headers;
}

/** In-process builtin pack — looks like an McpConnection to the manager. */
class BuiltinConnection {
  constructor(id, pack) {
    this.id = id;
    this.spec = { builtin: true };
    this.transport = 'builtin';
    this.tools = (pack.tools || []).map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {},
      run: t.run,
    }));
    this.connected = true;
    this.error = null;
    this.source = 'builtin';
    this._pack = pack;
  }

  async connect() { return this.tools; }

  async callTool(name, args) {
    const tool = this.tools.find(t => t.name === name);
    if (!tool) throw new Error(`MCP ${this.id}: unknown tool "${name}"`);
    const out = await tool.run(args || {});
    return typeof out === 'string' ? out : JSON.stringify(out);
  }

  close() { /* nothing to kill */ }
}

/**
 * Manages all configured MCP servers. One per process; connect() is idempotent.
 */
export class McpManager {
  constructor(getConfig) {
    this.getConfig = getConfig;          // () => config object
    this.connections = new Map();        // id → McpConnection | BuiltinConnection
    this._connecting = null;
    this._lastUsed = new Map();          // id → ts (LRU for user HTTP/stdio)
  }

  _maxHot() {
    return this.getConfig()?.mcpCatalog?.maxHotConnections || 16;
  }

  _defaultHttpDisabled() {
    return this.getConfig()?.mcpDefaultHttp?.disabled || [];
  }

  _defaultHttpEnabled() {
    return this.getConfig()?.mcpDefaultHttp?.enabled !== false;
  }

  /** User mcpServers overlay the shipped no-auth HTTP defaults. User wins on id. */
  _allServers() {
    const user = this._normalize(this.getConfig()?.mcpServers);
    if (!this._defaultHttpEnabled()) return user;
    const defaults = defaultHttpSpecs({ disabled: this._defaultHttpDisabled() });
    return { ...defaults, ...user };
  }

  _attachBuiltins() {
    const cfg = this.getConfig() || {};
    if (cfg.mcpBuiltin?.enabled === false) return;
    const disabled = cfg.mcpBuiltin?.disabled || [];
    for (const pack of loadBuiltinPacks({ disabled })) {
      // Never let a user server overwrite a builtin id.
      if (this.connections.has(pack.id) && this.connections.get(pack.id).transport !== 'builtin') continue;
      this.connections.set(pack.id, new BuiltinConnection(pack.id, pack));
      console.log(`[MCP] ✓ builtin ${pack.id} — ${pack.tools.length} tool(s)`);
    }
  }

  /** Connect to every server in config.mcpServers. Safe to call more than once. */
  async connectAll() {
    if (this._connecting) return this._connecting;
    this._connecting = (async () => {
      this._attachBuiltins();
      const userServers = this._normalize(this.getConfig()?.mcpServers);
      const userIds = Object.keys(userServers);
      if (userIds.length) {
        console.log(`[MCP] Connecting to ${userIds.length} user MCP server(s): ${userIds.join(', ')}`);
        await Promise.allSettled(userIds.map(id => this._connectOne(id, userServers[id])));
      } else if (!this.connections.size) {
        console.log('[MCP] No user MCP servers configured.');
      }
      // Shipped HTTP defaults stay catalog-seeded and connect on first call
      // (ensure/callTool) so startup doesn't open 8 extra sockets.
    })();
    try { await this._connecting; } finally { this._connecting = null; }
  }

  async _connectOne(id, spec) {
    if (!spec || spec.enabled === false || spec.disabled === true) return null;
    if (this.connections.get(id)?.transport === 'builtin') {
      console.warn(`[MCP] skipping server "${id}" — builtin id is reserved`);
      return this.connections.get(id);
    }
    const conn = new McpConnection(id, spec);
    this.connections.set(id, conn);
    this._lastUsed.set(id, Date.now());
    try {
      const tools = await conn.connect();
      console.log(`[MCP] ✓ ${id} connected — ${tools.length} tool(s): ${tools.map(t => t.name).join(', ') || '(none)'}`);
      return conn;
    } catch (err) {
      console.warn(`[MCP] ✗ ${id} failed: ${err.message}`);
      return null;
    }
  }

  /** Connect a single user or shipped-default server on demand. */
  async ensure(id) {
    const existing = this.connections.get(id);
    if (existing?.connected) {
      this._lastUsed.set(id, Date.now());
      return existing;
    }
    if (existing?.transport === 'builtin') return existing;
    const spec = this._allServers()[id];
    if (!spec || spec.enabled === false || spec.disabled === true) {
      throw new Error(`unknown MCP server "${id}"`);
    }
    this._evictHot();
    const conn = new McpConnection(id, spec);
    this.connections.set(id, conn);
    this._lastUsed.set(id, Date.now());
    await conn.connect();
    return conn;
  }

  _evictHot() {
    const hot = [...this.connections.entries()].filter(([, c]) => c.transport !== 'builtin' && c.connected);
    const cap = this._maxHot();
    if (hot.length < cap) return;
    hot.sort((a, b) => (this._lastUsed.get(a[0]) || 0) - (this._lastUsed.get(b[0]) || 0));
    const [id, conn] = hot[0];
    try { conn.close(); } catch { /* ignore */ }
    this.connections.delete(id);
    this._lastUsed.delete(id);
  }

  /** Accept both the standard object map and a legacy array shape. */
  _normalize(raw) {
    if (!raw) return {};
    if (Array.isArray(raw)) {
      const out = {};
      for (const s of raw) if (s && s.id) out[s.id] = s;
      return out;
    }
    return typeof raw === 'object' ? raw : {};
  }

  /** All tools across connected servers, names namespaced as "<server>__<tool>". */
  listTools() {
    const out = [];
    for (const [id, conn] of this.connections) {
      if (!conn.connected) continue;
      const source = conn.transport === 'builtin' ? 'builtin' : 'user';
      for (const t of conn.tools) {
        out.push({
          name: `${id}__${t.name}`, server: id, tool: t.name,
          description: t.description, inputSchema: t.inputSchema, source,
        });
      }
    }
    return out;
  }

  listCards() {
    const cfg = this.getConfig() || {};
    const disabled = cfg.mcpBuiltin?.disabled || [];
    const builtin = (cfg.mcpBuiltin?.enabled === false) ? [] : listBuiltinCards({ disabled });
    const live = [];
    const liveMcpIds = new Set();
    for (const t of this.listTools()) {
      if (t.source === 'builtin') continue;
      liveMcpIds.add(t.server);
      live.push({
        id: `${t.server}/${t.tool}`,
        mcpId: t.server,
        tool: t.tool,
        qualified: t.name,
        summary: (t.description || t.tool).slice(0, 180),
        tags: [],
        triggers: [t.server, t.tool],
        tools: [t.tool],
        source: t.source || 'user',
      });
    }
    const seed = this._defaultHttpEnabled()
      ? defaultHttpSeedCards({ disabled: this._defaultHttpDisabled() }).filter(c => !liveMcpIds.has(c.mcpId))
      : [];
    return [
      ...builtin.map(c => ({ ...c, source: 'builtin', qualified: `${c.mcpId}__${c.tool}` })),
      ...seed,
      ...live,
    ];
  }

  listServerIds() {
    return [...this.connections.keys()];
  }

  hasTools() { return this.listTools().length > 0; }

  /** Call a namespaced tool ("<server>__<tool>") or a bare tool name if unique. */
  async callTool(qualifiedName, args) {
    let serverId, toolName;
    const sep = qualifiedName.indexOf('__');
    if (sep >= 0) { serverId = qualifiedName.slice(0, sep); toolName = qualifiedName.slice(sep + 2); }
    else {
      // bare name — find the (unique) server exposing it (live or seed cards)
      const matches = this.listTools().filter(t => t.tool === qualifiedName);
      if (matches.length === 1) {
        serverId = matches[0].server; toolName = qualifiedName;
      } else {
        const seeded = this.listCards().filter(c => c.tool === qualifiedName && c.source !== 'builtin');
        if (seeded.length !== 1) throw new Error(`ambiguous or unknown tool "${qualifiedName}"`);
        serverId = seeded[0].mcpId; toolName = qualifiedName;
      }
    }
    let conn = this.connections.get(serverId);
    if (!conn?.connected) {
      conn = await this.ensure(serverId);
    }
    if (!conn) throw new Error(`unknown MCP server "${serverId}"`);
    this._lastUsed.set(serverId, Date.now());
    return conn.callTool(toolName, args);
  }

  status() {
    return [...this.connections.values()].map(c => ({
      id: c.id, transport: c.transport, connected: c.connected,
      error: c.error, tools: c.tools.map(t => t.name),
      source: c.transport === 'builtin' ? 'builtin' : 'user',
    }));
  }

  builtinStatus() {
    const cfg = this.getConfig() || {};
    return {
      enabled: cfg.mcpBuiltin?.enabled !== false,
      disabled: cfg.mcpBuiltin?.disabled || [],
      tools: this.listTools().filter(t => t.source === 'builtin').map(t => t.name),
    };
  }

  closeAll() {
    for (const c of this.connections.values()) c.close();
    this.connections.clear();
    this._lastUsed.clear();
  }
}

/**
 * True when the MCP rejection is a malformed call (missing required args,
 * schema mismatch) rather than a peer/network failure. Those must not fall
 * back to a second local attempt — that burns the work twice and disguises
 * the cause as a dispersal problem.
 */
export function isMcpArgumentError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  if (/\b(econn|etimedout|enotfound|socket|network|fetch failed|not connected|timed out|peer mcp http 5|http 5\d\d)\b/.test(m)) {
    return false;
  }
  return /\b(required|missing (required )?(arg|argument|parameter|field)|invalid (arg|argument|parameter)|indexes required|schema validation|must be (a |an )?(string|number|array|object|boolean)|city or latitude)\b/.test(m);
}
