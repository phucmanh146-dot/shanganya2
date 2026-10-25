# Cloudflare Worker MCP gateway

This Worker provides a server-side MCP tools discovery endpoint and CORS handling for the standalone Maiai Buddy project. It does **not** bypass official authentication: an upstream HTTP 403 means the official endpoint rejected the token/account or the endpoint is not available to that account.

## Deploy

1. Install Wrangler locally: `npm install -g wrangler`
2. Log in: `wrangler login`
3. Set the secret interactively (do not commit it): `wrangler secret put MCD_MCP_TOKEN`
4. Edit `APP_ORIGIN` in `wrangler.toml` to the exact public frontend origin instead of `*`.
5. Deploy: `wrangler deploy`
6. Check `https://<worker-name>.<account-subdomain>.workers.dev/api/health`
7. Test tools discovery with a POST request to `/api/mcp/tools` and `content-type: application/json`.

The health endpoint can be successful while MCP authentication is not configured. The tools endpoint returns `ok: true` only after the official server successfully answers both `initialize` and `tools/list`. An official upstream 401/403 is reported as a gateway error with a diagnostic hint rather than falsely claiming the connection succeeded.

## Security notes

- Never place the MCP token in browser JavaScript, source control, public issue comments, or the frontend.
- Restrict `APP_ORIGIN` to the actual frontend origin for production.
- This first version exposes only MCP initialization and tool discovery, not arbitrary tool execution or ordering.
- No credentials are included in this repository.
