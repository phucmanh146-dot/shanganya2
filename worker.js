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
      "vary": "Origin",
      "x-content-type-options": "nosniff"
    }
  });
}

function parseRpcResponse(raw, id) {
  const dataLines = raw.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim());
  for (const line of (dataLines.length ? dataLines : [raw])) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.id === id) return parsed;
    } catch {}
  }
  return null;
}

async function rpc(env, method, params, id, session = "") {
  const endpoint = env.MCD_MCP_ENDPOINT || DEFAULT_UPSTREAM;
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "authorization": `Bearer ${env.MCD_MCP_TOKEN}`,
    "mcp-protocol-version": "2025-03-26"
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
    const error = new Error(`Official MCP returned HTTP ${upstream.status}`);
    error.status = upstream.status;
    throw error;
  }
  const message = parseRpcResponse(raw, id);
  if (!message) throw new Error("MCP returned no matching JSON-RPC response");
  if (message.error) throw new Error(message.error.message || "MCP JSON-RPC error");
  return { result: message.result, session: nextSession };
}

async function notifyInitialized(env, session = "") {
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "authorization": `Bearer ${env.MCD_MCP_TOKEN}`,
    "mcp-protocol-version": "2025-03-26"
  };
  if (session) headers["mcp-session-id"] = session;
  const response = await fetch(env.MCD_MCP_ENDPOINT || DEFAULT_UPSTREAM, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const error = new Error(`MCP initialized notification returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = env.APP_ORIGIN || "*";
    const originAllowed = allowedOrigin === "*" || !origin || origin === allowedOrigin;
    const corsOrigin = allowedOrigin === "*" ? "*" : (originAllowed ? allowedOrigin : "");
    const corsHeaders = {
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "86400",
      "vary": "Origin",
      ...(corsOrigin ? { "access-control-allow-origin": corsOrigin } : {})
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "maimai-buddy-worker", mcpConfigured: Boolean(env.MCD_MCP_TOKEN),
        endpointConfigured: Boolean(env.MCD_MCP_ENDPOINT || DEFAULT_UPSTREAM) }, 200, corsOrigin || "null");
    }

    if (url.pathname === "/api/mcp/tools" && request.method === "POST") {
      if (!originAllowed) return json({ ok: false, error: "Origin is not allowed. Set APP_ORIGIN to the exact frontend origin." }, 400, "null");
      if (!env.MCD_MCP_TOKEN) return json({ ok: false, error: "MCD_MCP_TOKEN secret is missing. Set it with: wrangler secret put MCD_MCP_TOKEN" }, 503, corsOrigin || "null");
      try {
        const init = await rpc(env, "initialize", {
          protocolVersion: "2025-03-26", capabilities: {},
          clientInfo: { name: "maimai-buddy-worker", version: "1.1.0" }
        }, 1);
        await notifyInitialized(env, init.session);
        const listed = await rpc(env, "tools/list", {}, 2, init.session);
        return json({ ok: true, serverInfo: init.result?.serverInfo || null,
          tools: (listed.result?.tools || []).map(tool => ({
            name: tool.name, description: tool.description, inputSchema: tool.inputSchema
          }))
        }, 200, corsOrigin || "null");
      } catch (error) {
        const upstreamStatus = Number(error.status || 0);
        return json({
          ok: false,
          error: String(error.message || error),
          upstreamStatus: upstreamStatus || null,
          hint: upstreamStatus === 401 || upstreamStatus === 403
            ? "Worker is reachable, but official MCP rejected authentication/permission. Re-issue or activate a valid MCP Token in the official console, then update the Cloudflare Worker secret. A proxy cannot bypass official authorization."
            : "Check Worker logs, MCP endpoint, network and Streamable HTTP protocol response."
        }, 502, corsOrigin || "null");
      }
    }

    return json({ ok: false, error: "Not found" }, 404, corsOrigin || "null");
  }
};
