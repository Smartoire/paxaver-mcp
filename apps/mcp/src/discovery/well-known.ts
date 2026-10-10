/**
 * Well-known discovery endpoints (RFC 9728, RFC 8414) and ChatGPT domain verification.
 *
 * Each region (CA, US, MX) has its own auth server. MCP clients use one
 * authorization server only, so the MCP server is the authorization server
 * that clients see: a facade. Its endpoints (/oauth/authorize, /oauth/token,
 * /oauth/register, /oauth/revoke) let the user pick a region and route each
 * call to that region's auth server. Tokens still come from the regional
 * servers; the MCP server only validates them.
 */

import type { Env } from '../env.js';
import { ALL_TOOLS, ALL_RESOURCES, ALL_PROMPTS } from '../schemas.js';
import { issuersFor } from '../lib/regions.js';
import { originFrom } from '../lib/url.js';
import { SERVER_VERSION } from '../lib/version.js';

const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'tools'];

// RFC 9728: Protected Resource Metadata
// Points to the facade on this origin. The `resource` field is the
// canonical identifier of the protected resource — the MCP endpoint URL
// (`<origin>/mcp`), the same URL clients configure as the MCP server.
// Clients send it as the OAuth `resource` parameter and it lands verbatim in
// the token audience, so validate.ts accepts both the origin and the
// endpoint form.
function protectedResourceHandler(request: Request): Response {
  const origin = originFrom(request.url);
  return Response.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_parameter_supported: true,
  });
}

// RFC 8414 / OIDC discovery: the facade's metadata. Clients find it from
// authorization_servers above, or probe the MCP server for it directly.
// jwks_uri points at one regional server: every region publishes the same
// key, and the token `iss` (not the key) identifies the region.
function authorizationServerMetadata(request: Request, env: Env): Record<string, unknown> {
  const origin = originFrom(request.url);
  const jwksIssuer = issuersFor(env)[0]?.issuer ?? 'https://paxaver.dev/auth';
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    registration_endpoint: `${origin}/oauth/register`,
    jwks_uri: `${jwksIssuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: SCOPES,
    require_pkce: true,
    resource_parameter_supported: true,
  };
}

function openidConfigurationHandler(request: Request, env: Env): Response {
  return Response.json({
    ...authorizationServerMetadata(request, env),
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
  });
}

function serverCardHandler(request: Request): Response {
  const origin = originFrom(request.url);
  return Response.json({
    serverInfo: {
      name: 'paxaver-mcp',
      version: SERVER_VERSION,
    },
    authentication: {
      required: true,
      schemes: ['oauth2'],
    },
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    resources: ALL_RESOURCES.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
    prompts: ALL_PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
    _links: {
      transport: `${origin}/mcp`,
    },
  });
}

async function wellKnownFetch(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);

  const protectedPaths = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/mcp/.well-known/oauth-protected-resource',
  ];
  const authPaths = [
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp',
    '/mcp/.well-known/oauth-authorization-server',
  ];
  const openidPaths = [
    '/.well-known/openid-configuration',
    '/.well-known/openid-configuration/mcp',
    '/mcp/.well-known/openid-configuration',
  ];

  let response: Response;
  if (protectedPaths.includes(pathname)) {
    response = protectedResourceHandler(request);
  } else if (authPaths.includes(pathname)) {
    response = Response.json(authorizationServerMetadata(request, env));
  } else if (openidPaths.includes(pathname)) {
    response = openidConfigurationHandler(request, env);
  } else if (pathname === '/.well-known/mcp/server-card.json') {
    response = serverCardHandler(request);
  } else if (pathname === '/.well-known/openai-apps-challenge') {
    // ChatGPT app submission domain verification. The token is provided by
    // OpenAI during submission; until then the endpoint does not exist.
    const token = env.OPENAI_APPS_CHALLENGE;
    response = token
      ? new Response(token, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      : new Response('Not found', { status: 404 });
  } else {
    response = new Response('Not found', { status: 404 });
  }

  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}

export const wellKnownApp = { fetch: wellKnownFetch };
