const DEFAULT_UPSTREAM = "https://mcp.mcd.cn";

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "x-content-type-options": "nosniff"
    }
  });
}

async function rpc(env, method, params, id, session = "") {
  const endpoint = env.MCD_MCP_ENDPOINT || DEFAULT_UPSTREAM;
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "authorization": `Bearer ${env.MCD_MCP_TOKEN}`
  };
  if (session) headers["mcp-session-id"] = session;
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(15000)
  });
  const nextSession = upstream.headers.get("mcp-session-id") || session;
  const raw = await upstream.text();
  if (!upstream.ok) {
    // Keep the upstream auth status visible; never fake a successful connection.
    throw Object.assign(new Error(`Official MCP returned HTTP ${upstream.status}`), { status: upstream.status });
  }
  const dataLines = raw.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim());
  let message = null;
  for (const line of (dataLines.length ? dataLines : [raw])) {
    try { const parsed = JSON.parse(line); if (parsed.id === id) message = parsed; } catch {}
  }
  if (!message) throw new Error("MCP returned no matching JSON-RPC response");
  if (message.error) throw new Error(message.error.message || "MCP JSON-RPC error");
  return { result: message.result, session: nextSession };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "*";
    const allowedOrigin = env.APP_ORIGIN || "*";
    const corsOrigin = allowedOrigin === "*" || origin === allowedOrigin ? origin : allowedOrigin;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": corsOrigin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "86400",
      "vary": "Origin"
    }});
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "maimai-buddy-worker", mcpConfigured: Boolean(env.MCD_MCP_TOKEN) }, 200, corsOrigin);
    }
    if (url.pathname === "/api/mcp/tools" && request.method === "POST") {
      if (!env.MCD_MCP_TOKEN) return json({ ok: false, error: "MCD_MCP_TOKEN secret is not configured in Cloudflare Worker." }, 503, corsOrigin);
      try {
        const init = await rpc(env, "initialize", {
          protocolVersion: "2025-03-26", capabilities: {},
          clientInfo: { name: "maimai-buddy-worker", version: "1.0.0" }
        }, 1);
        const listed = await rpc(env, "tools/list", {}, 2, init.session);
        return json({ ok: true, serverInfo: init.result?.serverInfo || null,
          tools: (listed.result?.tools || []).map(tool => ({
            name: tool.name, description: tool.description, inputSchema: tool.inputSchema
          }))
        }, 200, corsOrigin);
      } catch (error) {
        const upstreamStatus = Number(error.status || 0);
        const status = upstreamStatus === 401 || upstreamStatus === 403 ? 502 : 502;
        return json({ ok: false, error: String(error.message || error), upstreamStatus: upstreamStatus || null,
          hint: upstreamStatus === 403
            ? "Cloudflare Worker is reachable, but the official MCP denied the credential/account. Verify token validity, account permission, and the official endpoint; a proxy cannot grant access."
            : "Check the Cloudflare secret, endpoint, network and MCP protocol response."
        }, status, corsOrigin);
      }
    }
    return json({ ok: false, error: "Not found" }, 404, corsOrigin);
  }
};
