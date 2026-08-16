/**
 * Paxaver MCP server environment bindings.
 *
 * Secrets (set via `wrangler secret put` per environment):
 *   - JWT_SECRET            — used only for service-binding JWTs to call the
 *                             Paxaver API. OAuth tokens are RS256 JWTs from
 *                             the auth worker, validated via JWKS.
 *   - CHATGPT_VERIFY_TOKEN  — ChatGPT marketplace domain verification (optional)
 *
 * Service bindings (configured in wrangler.jsonc per env, not here):
 *   - PAXAVER_API           — Fetch interface to the same-region Paxaver
 *                             backend worker.
 *
 * No D1 binding. The MCP server never touches the database directly.
 */

export interface Env {
  // --- Cloudflare service binding to the Paxaver backend (same region) ---
  PAXAVER_API?: Fetcher;

  // --- Public vars (wrangler.jsonc) ---
  ENVIRONMENT: 'development' | 'staging' | 'production';
  REGION: 'ca' | 'us';
  DEFAULT_CURRENCY: string;
  ALLOWED_ORIGINS: string;
  API_BASE_URL: string;

  // --- Secrets (wrangler secret) ---
  JWT_SECRET: string;
  CHATGPT_VERIFY_TOKEN?: string;
}

export interface AuthContext {
  userId: string;
  email: string;
  schoolSlug: string;
  permissions: string[];
  isPlatformAdmin: boolean;
  studentIds: string[];
}

export type AppBindings = Env;
export type AppVariables = AuthContext & {
  sessionId?: string;
  correlationId: string;
};
