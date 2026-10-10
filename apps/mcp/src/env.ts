/**
 * Paxaver MCP server environment bindings.
 *
 * Service bindings (configured in wrangler.jsonc):
 *   - PAXAVER_API_CA        — Fetch interface to the CA Paxaver backend worker.
 *   - PAXAVER_API_US        — Fetch interface to the US Paxaver backend worker.
 *   - PAXAVER_API_MX        — Fetch interface to the MX Paxaver backend worker.
 *
 * The MCP server routes to the correct regional backend based on the
 * region of the verified JWT issuer (see lib/regions.ts).
 *
 * No D1 binding. The MCP server never touches the database directly.
 */

export interface Env {
  // --- Cloudflare service bindings to regional backends ---
  PAXAVER_API_CA?: Fetcher;
  PAXAVER_API_US?: Fetcher;
  PAXAVER_API_MX?: Fetcher;

  // --- Public vars (wrangler.jsonc) ---
  ENVIRONMENT: 'development' | 'staging' | 'production';
  ALLOWED_ORIGINS: string;
  API_BASE_URL_CA: string;
  API_BASE_URL_US: string;
  API_BASE_URL_MX: string;

  /**
   * Shared secret for internal service-binding endpoints
   * (GET /internal/auth/verify — token revocation check). Required in
   * staging/production; unset is allowed in development/test where the
   * backend guard skips enforcement.
   */
  INTERNAL_SERVICE_SECRET?: string;

  /**
   * Alexa skill id (`amzn1.ask.skill.…`). Requests to POST /alexa must carry
   * this application id. Required in staging/production: unset fails closed.
   */
  ALEXA_SKILL_ID?: string;

  /** Git SHA injected by the deploy command (--var); exposed on /health. */
  COMMIT_SHA?: string;

  /** Set during ChatGPT app submission to prove domain ownership. */
  OPENAI_APPS_CHALLENGE?: string;
}

export type McpCountry = 'ca' | 'us' | 'mx';

export interface AuthContext {
  userId: string;
  email: string;
  schoolSlug: string;
  permissions: string[];
  isPlatformAdmin: boolean;
  studentIds: string[];
  country: McpCountry;
  /** Original OAuth access token, used to call the Paxaver backend. */
  userToken?: string;
  /** Subscription status from the backend (undefined or null if none). */
  subscription?: {
    status: 'active' | 'expired' | 'none';
    toolLevel: string | null;
    expiry: string | null;
  } | null;
}

export type AppVariables = AuthContext & {
  sessionId?: string;
  correlationId: string;
  subscription?: AuthContext['subscription'] | null;
};
