import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { McpManager } from '../src/ai/mcp-client.js';

// A minimal MCP stdio server (initialize / tools/list / tools/call) written to a
// temp file and spawned as a real child process — exercises the actual transport.
const SERVER_SRC = `
let buf='';process.stdin.setEncoding('utf8');
process.stdin.on('data',c=>{buf+=c;let n;while((n=buf.indexOf('\\n'))>=0){const l=buf.slice(0,n).trim();buf=buf.slice(n+1);if(l)h(JSON.parse(l));}});
const s=m=>process.stdout.write(JSON.stringify(m)+'\\n');
function h(m){
  if(m.method==='initialize')s({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'mock',version:'1'}}});
  else if(m.method==='notifications/initialized'){}
  else if(m.method==='tools/list')s({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'add',description:'Add',inputSchema:{type:'object',properties:{a:{type:'number'},b:{type:'number'}}}}]}});
  else if(m.method==='tools/call'){const{name,arguments:a}=m.params;if(name==='add')s({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:String((a.a||0)+(a.b||0))}]}});else s({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'unknown'}});}
  else if(m.id!=null)s({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'nf'}});
}
`;

const serverPath = path.join(os.tmpdir(), `poh-mcp-mock-${Date.now()}.mjs`);
fs.writeFileSync(serverPath, SERVER_SRC);

describe('McpManager', () => {
  afterAll(() => { try { fs.unlinkSync(serverPath); } catch {} });

  it('connects to a stdio server, lists namespaced tools, and calls them', async () => {
    const mgr = new McpManager(() => ({ mcpServers: { mock: { command: 'node', args: [serverPath] } } }));
    await mgr.connectAll();

    const status = mgr.status();
    expect(status.find(s => s.id === 'mock')?.connected).toBe(true);

    const tools = mgr.listTools();
    expect(tools.map(t => t.name)).toContain('mock__add');

    expect(await mgr.callTool('mock__add', { a: 2, b: 40 })).toBe('42');
    expect(await mgr.callTool('add', { a: 1, b: 1 })).toBe('2'); // bare unique name

    await expect(mgr.callTool('mock__nope', {})).rejects.toThrow();
    mgr.closeAll();
  });

  it('skips disabled servers and no-ops with none configured', async () => {
    const mgr = new McpManager(() => ({ mcpServers: { off: { command: 'node', args: [serverPath], enabled: false } } }));
    await mgr.connectAll();
    expect(mgr.hasTools()).toBe(false);
    mgr.closeAll();

    const empty = new McpManager(() => ({}));
    await empty.connectAll();
    expect(empty.listTools()).toEqual([]);
  });
});
