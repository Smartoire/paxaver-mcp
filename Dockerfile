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
RUN chown node:node /app

# Run as the unprivileged user of the node image.
USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .

EXPOSE 8787

# Top-level wrangler.jsonc vars have no service bindings, so requests fall back
# to HTTPS against the production backends. --var overrides the localhost
# defaults used for local Paxaver backend development.
#
# WARNING: revocation is skipped. A self-hosted server has no
# INTERNAL_SERVICE_SECRET, so REVOCATION_CHECK:skip turns off the token
# revocation check against the production issuers. A revoked token stays
# valid here until it expires. Tokens are still checked by signature, expiry
# and a live user-context load.
#
# CORS: ALLOWED_ORIGINS keeps the localhost defaults from wrangler.jsonc.
# To allow a browser client, add "ALLOWED_ORIGINS:<exact origin>" (or
# "https://*.<domain>"). A bare "*" matches no origin.
CMD ["pnpm", "exec", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787", \
     "--var", "ENVIRONMENT:production", \
     "REVOCATION_CHECK:skip", \
     "API_BASE_URL_CA:https://paxaver.ca", \
     "API_BASE_URL_US:https://paxaver.com", \
     "API_BASE_URL_MX:https://paxaver.mx"]
