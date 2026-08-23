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
  "vars": {/* top-level defaults for local dev */},
}
```

- `nodejs_compat` is required for `jose` and `Hono` under the Workers runtime.
- `preview_urls: false` — deployments are only reachable via the custom domain.
- Observability is enabled at 100% sampling for request tracing.

## Environments

| `--env`      | Worker name           | Domain            | API backends                         |
| ------------ | --------------------- | ----------------- | ------------------------------------ |
| `staging`    | `paxaver-mcp-staging` | `mcp.paxaver.dev` | `paxaver.dev/api`                    |
| `production` | `paxaver-mcp`         | `mcp.paxaver.com` | `paxaver.ca/api` + `paxaver.com/api` |

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

The MCP worker calls the Paxaver backend via Cloudflare **service bindings**.
The production worker has two bindings:

- `PAXAVER_API_CA` → `paxaver-api-ca` (Canadian users)
- `PAXAVER_API_US` → `paxaver-api-us` (US users)

The correct backend is selected per request based on the authenticated user's
tenant country (derived from the JWT `tenant_id` claim).

Service bindings are configured in `wrangler.jsonc` under each environment's
`services` array.

When `PAXAVER_API` is absent (local dev), the client falls back to authenticated
HTTPS against `API_BASE_URL`. This is fine for development but the service
binding is required for production.

## Secrets

Set per environment with `wrangler secret put --env <env> <NAME>`:

| Secret                 | Required | Purpose                                                                                             |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`           | **yes**  | Signs OAuth access tokens **and** short-lived service-binding JWTs. Shared with the backend Worker. |
| `GOOGLE_CLIENT_ID`     | no       | Google sign-in.                                                                                     |
| `GOOGLE_CLIENT_SECRET` | no       | Google sign-in.                                                                                     |
| `CHATGPT_VERIFY_TOKEN` | no       | ChatGPT marketplace domain verification (`/.well-known/openai-apps-challenge`).                     |

> `JWT_SECRET` must be identical between the MCP Worker and the Paxaver API
> Worker in the same region, because both sign and verify service JWTs with it.

Example:

```bash
wrangler secret put JWT_SECRET --env production
wrangler secret put CHATGPT_VERIFY_TOKEN --env production
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

# Production (single endpoint, routes to both regions)
npm run deploy:prod

# Dry-run build for all environments (CI uses this)
npm run wrangler:check
```

## Smoke tests

Post-deploy smoke tests hit the live endpoint:

```bash
npm run smoke:staging         # tests/smoke/staging.smoke.ts
npm run smoke:prod            # tests/smoke/prod.smoke.ts
```

These verify the health endpoint, discovery endpoints, and a basic
`initialize` handshake. They require network access and do not perform
authenticated tool calls.

## Rollback

Cloudflare Workers supports instant rollback via the dashboard or:

```bash
wrangler deployments list --env production
wrangler rollback --env production
```

Because the MCP server is stateless (no D1, sessions are per-isolate
correlation tokens), rollback is safe and immediate.
