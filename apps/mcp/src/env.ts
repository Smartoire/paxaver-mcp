/**
 * Paxaver MCP server environment bindings.
 *
 * Secrets (set via `wrangler secret put`):
 *   - CHATGPT_VERIFY_TOKEN  — ChatGPT marketplace domain verification (optional)
 *
 * Service bindings (configured in wrangler.jsonc):
 *   - PAXAVER_API_CA        — Fetch interface to the CA Paxaver backend worker.
 *   - PAXAVER_API_US        — Fetch interface to the US Paxaver backend worker.
 *
 * The MCP server routes to the correct regional backend based on the
 * authenticated user's tenant country (extracted from the JWT tenant_id claim
 * and confirmed via /api/users/me/context).
 *
 * No D1 binding. The MCP server never touches the database directly.
 */

export interface Env {
  // --- Cloudflare service bindings to both regional backends ---
  PAXAVER_API_CA?: Fetcher;
  PAXAVER_API_US?: Fetcher;

  // --- Public vars (wrangler.jsonc) ---
  ENVIRONMENT: 'development' | 'staging' | 'production';
  ALLOWED_ORIGINS: string;
  API_BASE_URL_CA: string;
  API_BASE_URL_US: string;

  // --- Secrets (wrangler secret) ---
  CHATGPT_VERIFY_TOKEN?: string;
}

export interface AuthContext {
  userId: string;
  email: string;
  schoolSlug: string;
  permissions: string[];
  isPlatformAdmin: boolean;
  studentIds: string[];
  country: 'ca' | 'us';
  /** Original OAuth access token, used to call the Paxaver backend. */
  userToken?: string;
  /** Subscription status from the backend. */
  subscription?: {
    status: 'active' | 'expired' | 'none';
    toolLevel: string | null;
    expiry: string | null;
  };
}

export type AppVariables = AuthContext & {
  sessionId?: string;
  correlationId: string;
  subscription?: AuthContext['subscription'] | null;
};
