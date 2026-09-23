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

When the `PAXAVER_API_*` bindings are absent (local dev), the client falls back
to authenticated HTTPS against `API_BASE_URL_CA`, `API_BASE_URL_US`, and
`API_BASE_URL_MX`. This is fine for development but the service bindings are
required for production.

## Secrets

- `INTERNAL_SERVICE_SECRET` — shared secret sent as `x-internal-secret` on the
  internal token-revocation check (`GET /internal/auth/verify`). Should be set
  in staging and production to activate revocation enforcement; until it is
  provisioned the check is skipped (a warning is logged once per isolate) and
  bearer validation falls back to JWKS + live context. Set it per environment
  with `wrangler secret put --env <env> INTERNAL_SERVICE_SECRET`. For local
  development use a `.dev.vars` file (gitignored).

## Deploy commands

```bash
# Staging
npm run deploy:staging        # wrangler deploy --env staging

# Production (single endpoint, routes to both regions)
npm run deploy:prod

# Dry-run build for all environments (CI uses this)
npm run wrangler:check
```

## Release checklist

A version bump is not done at deploy. External metadata must also be
updated or the audit's version/directory checks flag the release:

1. `gh release create vX.Y.Z` on GitHub (deploy pipeline tags but does not
   create release objects).
2. `mcp-publisher publish` to the Official MCP Registry — or rely on
   `.github/workflows/publish-registry.yml`, which runs automatically on
   `v*` tags via GitHub OIDC.
3. Update the Wellknown agent record (`PATCH
https://wellknown.network/api/v1/agents/paxaver-mcp`, `declared.version`)
   with the Smartoire owner's API key — no automated path exists yet.
4. Verify `pnpm package:microsoft` output was committed before tagging so
   `certification/microsoft/mcptools.json` matches the tool surface.

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
