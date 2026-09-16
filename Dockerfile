# Self-hosted Paxaver MCP server (development mode).
# Runs the Cloudflare Worker locally via wrangler and proxies the regional
# Paxaver backends over authenticated HTTPS (API_BASE_URL_* vars).
#
#   docker build -t paxaver-mcp .
#   docker run -p 8787:8787 paxaver-mcp
#
# MCP endpoint: http://localhost:8787/mcp
FROM node:26-slim

RUN npm install -g pnpm@10.25.0
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 8787

# Top-level wrangler.jsonc vars have no service bindings, so requests fall back
# to HTTPS against the production backends. --var overrides the localhost
# defaults used for local Paxaver backend development.
CMD ["pnpm", "exec", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787", \
     "--var", "ENVIRONMENT:production", \
     "ALLOWED_ORIGINS:*", \
     "API_BASE_URL_CA:https://paxaver.ca", \
     "API_BASE_URL_US:https://paxaver.com", \
     "API_BASE_URL_MX:https://paxaver.mx"]
