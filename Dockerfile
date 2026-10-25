FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY server.mjs ./server.mjs
COPY index.html ./index.html
COPY MCP_INTEGRATION.md ./MCP_INTEGRATION.md
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
