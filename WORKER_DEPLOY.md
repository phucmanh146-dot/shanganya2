# Cloudflare Worker MCP 网关部署与 403 排查

本 Worker 通过服务端 Secret 调用麦当劳官方 Streamable HTTP MCP，并提供 CORS 预检、健康检查和真实工具发现。它不会绕过官方鉴权，也不会伪造 MCP 连接成功。

## 部署

1. 安装 Node.js 20+，在项目根目录运行 `npx wrangler@latest login`，按浏览器提示登录 Cloudflare。
2. 在 `wrangler.toml` 中将 `APP_ORIGIN` 改为前端实际来源，例如 `https://your-site.pages.dev`；不要在正式环境使用通配符。
3. 设置官方 Token Secret：`npx wrangler@latest secret put MCD_MCP_TOKEN`。在交互提示中粘贴从官方 MCP 控制台申请并激活的 Token；不要把 Token 写进文件或提交到 GitHub。
4. 确认 `MCD_MCP_ENDPOINT = "https://mcp.mcd.cn"`，然后运行 `npx wrangler@latest deploy`。
5. 打开 `https://<worker-name>.<account-subdomain>.workers.dev/api/health`。`ok:true` 只说明 Worker 进程可用；`mcpConfigured:true` 只说明已设置 Secret，均不代表官方 MCP 鉴权成功。
6. 用 POST 请求调用 `/api/mcp/tools`。只有官方 `initialize`、`notifications/initialized` 和 `tools/list` 全部成功时，才会返回 `ok:true` 及真实工具列表。

## 403 / 401 排查

- **浏览器看到 CORS 错误**：检查 `APP_ORIGIN` 是否与前端来源完全一致（包含协议和端口），并检查预检请求是否到达 Worker。
- **Worker 返回 502，`upstreamStatus: 401/403`**：这是 Worker 对上游鉴权失败的规范化响应，不是已修复的真实授权。重新登录官方平台 https://open.mcd.cn/mcp，申请/激活有效 MCP Token，再执行 `npx wrangler@latest secret put MCD_MCP_TOKEN` 更新 Secret，随后重新测试。
- **Worker 返回 503**：没有设置 `MCD_MCP_TOKEN` Secret。
- **Worker 返回 502，其他状态**：查看 Cloudflare Dashboard → Workers & Pages → Logs；核对端点、协议版本和官方服务状态。
- **Worker 返回 404**：路径应为 `/api/health` 或 `/api/mcp/tools`。

不能通过改状态码、删掉 Authorization 或代理请求绕过官方权限。若官方端仍拒绝 Token，必须修复凭据或权限；不要把错误响应改成成功。

## 安全

- Token 只保存在 Cloudflare Worker Secret，不放在浏览器 JavaScript、`.env`、`wrangler.toml` 或公开 Issue。
- 本 Worker 当前只开放健康检查和 MCP 工具发现，不开放任意工具执行、领券或下单。
- 生产环境将 `APP_ORIGIN` 设为确切前端来源。
