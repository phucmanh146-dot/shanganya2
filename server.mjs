import http from 'node:http';
import { readFile } from 'node:fs/promises';
const PORT = Number(process.env.PORT || 8080);
const html = await readFile(new URL('./index.html', import.meta.url));
const endpoint = process.env.MCD_MCP_ENDPOINT || 'https://mcp.mcd.cn';

async function mcpRequest(token, method, params, id, session = '') {
  const headers = { 'Content-Type':'application/json', 'Accept':'application/json, text/event-stream', 'Authorization': 'Bearer ' + token };
  if (session) headers['Mcp-Session-Id'] = session;
  const res = await fetch(endpoint, { method:'POST', headers, body:JSON.stringify({jsonrpc:'2.0',id,method,params}), signal:AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('MCP HTTP ' + res.status);
  const nextSession = res.headers.get('mcp-session-id') || session;
  const raw = await res.text();
  const dataLines = raw.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trim());
  let msg;
  for (const line of (dataLines.length ? dataLines : [raw])) {
    try { const obj = JSON.parse(line); if (obj.id === id) msg = obj; } catch {}
  }
  if (!msg) throw new Error('MCP 未返回可识别的 JSON-RPC 响应');
  if (msg.error) throw new Error(msg.error.message || 'MCP JSON-RPC error');
  return { result:msg.result, session:nextSession };
}
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self' https: data:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data:; connect-src 'self' https:");
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); return res.end(html);
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}); return res.end(JSON.stringify({ok:true,app:'maimai-buddy',mcpConfigured:Boolean(process.env.MCD_MCP_TOKEN)}));
  }
  if (req.method === 'POST' && req.url === '/api/mcp/tools') {
    if (!process.env.MCD_MCP_TOKEN) { res.writeHead(503, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:false,error:'未配置 MCD_MCP_TOKEN；当前无法连接官方 MCP。'})); }
    try {
      const init = await mcpRequest(process.env.MCD_MCP_TOKEN,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'maimai-buddy',version:'0.1.0'}},1);
      const listed = await mcpRequest(process.env.MCD_MCP_TOKEN,'tools/list',{},2,init.session);
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({ok:true,serverInfo:init.result?.serverInfo || null,tools:(listed.result?.tools || []).map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema}))}));
    } catch(e) {
      res.writeHead(502, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({ok:false,error:String(e.message || e)}));
    }
  }
  res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Not found'}));
});
server.listen(PORT,'0.0.0.0',()=>console.log('Maiai Buddy listening on '+PORT));
