# Deployment

The Paxaver MCP server deploys as a Cloudflare Worker via Wrangler. There are
three environments, each a separate Worker with its own name, region, custom
domain, and secrets.

## Wrangler configuration

Config lives in [`wrangler.jsonc`](../wrangler.jsonc). Key fields:

```jsonc
{
  "name": "paxaver-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "preview_urls": false,
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "vars": { /* top-level defaults for local dev */ }
}
```

- `nodejs_compat` is required for `jose` and `Hono` under the Workers runtime.
- `preview_urls: false` — deployments are only reachable via the custom domain.
- Observability is enabled at 100% sampling for request tracing.

## Environments

| `--env` | Worker name | Domain | Region | Currency | API backend |
| ------- | ----------- | ------ | ------ | -------- | ----------- |
| `staging` | `paxaver-mcp-staging` | `mcp.paxaver.dev` | ca | CAD | `api.paxaver.dev` |
| `production-ca` | `paxaver-mcp-ca` | `mcp.paxaver.ca` | ca | CAD | `api.paxaver.ca` |
| `production-us` | `paxaver-mcp-us` | `mcp.paxaver.com` | us | USD | `api.paxaver.com` |

Each environment declares its own `vars` (region, currency, allowed origins,
API base URL) and `routes` (custom domain). The top-level config is used for
local `wrangler dev` only.

### Custom domains

Each environment maps a custom domain via the `routes` array:

```jsonc
"routes": [
  { "pattern": "mcp.paxaver.com", "zone_name": "paxaver.com", "custom_domain": true }
]
```

The corresponding zone (`paxaver.com`, `paxaver.ca`, `paxaver.dev`) must already
exist in the Cloudflare account. Wrangler creates the custom domain and the
requisite DNS record on first deploy.

### Allowed origins (CORS)

`ALLOWED_ORIGINS` is a comma-separated list. Wildcard subdomains are supported
via the `*.domain` pattern. Production environments include the AI client
origins (`chatgpt.com`, `claude.ai`, `www.perplexity.ai`) in addition to the
Paxaver app origins. See [security.md](./security.md) for the CORS policy.

## Service binding: `PAXAVER_API`

The MCP worker calls the Paxaver backend via a Cloudflare **service binding**
named `PAXAVER_API`. Service bindings are configured in the Cloudflare dashboard
(or via `wrangler` service-binding config), not in `wrangler.jsonc` vars, because
they reference another Worker by name.

Setup per environment:

1. In the Cloudflare dashboard, open the MCP Worker (e.g. `paxaver-mcp-ca`).
2. Go to **Settings → Bindings → Add binding → Service**.
3. Variable name: `PAXAVER_API`. Service: the same-region Paxaver API Worker
   (e.g. `paxaver-api-ca`). Environment: match (production → production).
4. Repeat for each environment. **Never** cross-bind regions (CA MCP → US API).

When `PAXAVER_API` is absent (local dev), the client falls back to authenticated
HTTPS against `API_BASE_URL`. This is fine for development but the service
binding is required for production.

## Secrets

Set per environment with `wrangler secret put --env <env> <NAME>`:

| Secret | Required | Purpose |
| ------ | -------- | ------- |
| `JWT_SECRET` | **yes** | Signs OAuth access tokens **and** short-lived service-binding JWTs. Shared with the backend Worker. |
| `OAUTH_STATE_SECRET` | **yes** | HMAC key for OAuth `state` CSRF tokens. |
| `GOOGLE_CLIENT_ID` | no | Google sign-in. |
| `GOOGLE_CLIENT_SECRET` | no | Google sign-in. |
| `CHATGPT_VERIFY_TOKEN` | no | ChatGPT marketplace domain verification (`/.well-known/openai-apps-challenge`). |

> `JWT_SECRET` must be identical between the MCP Worker and the Paxaver API
> Worker in the same region, because both sign and verify service JWTs with it.

Example:

```bash
wrangler secret put JWT_SECRET --env production-ca
wrangler secret put OAUTH_STATE_SECRET --env production-ca
wrangler secret put CHATGPT_VERIFY_TOKEN --env production-ca
```

For local development, use a `.dev.vars` file (gitignored):

```
JWT_SECRET=local-dev-secret-change-me
OAUTH_STATE_SECRET=local-dev-state-secret
```

## Deploy commands

```bash
# Staging
npm run deploy:staging        # wrangler deploy --env staging

# Production (each region independently)
npm run deploy:ca             # wrangler deploy --env production-ca
npm run deploy:us             # wrangler deploy --env production-us

# Both production regions
npm run deploy:prod

# Dry-run build for all environments (CI uses this)
npm run wrangler:check
```

## Smoke tests

Post-deploy smoke tests hit the live endpoint:

```bash
npm run smoke:staging         # tests/smoke/staging.smoke.ts
npm run smoke:ca              # tests/smoke/ca.smoke.ts
npm run smoke:us              # tests/smoke/us.smoke.ts
```

These verify the health endpoint, discovery endpoints, and a basic
`initialize` handshake. They require network access and do not perform
authenticated tool calls.

## Rollback

Cloudflare Workers supports instant rollback via the dashboard or:

```bash
wrangler deployments list --env production-ca
wrangler rollback --env production-ca
```

Because the MCP server is stateless (no D1, sessions are per-isolate
correlation tokens), rollback is safe and immediate.
