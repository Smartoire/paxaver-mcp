/**
 * Well-known discovery endpoints (RFC 9728, RFC 8414) and ChatGPT domain verification.
 *
 * OAuth is delegated to the canonical auth worker for the current environment.
 * The MCP server is a resource server, not an authorization server.
 */

import type { Env } from '../env.js';
import { ALL_TOOLS, ALL_RESOURCES, ALL_PROMPTS } from '../schemas.js';
import { authUrl } from '../auth/validate.js';
import { originFrom } from '../lib/url.js';
import { SERVER_VERSION } from '../lib/version.js';

// RFC 9728: Protected Resource Metadata
// Points to the environment's canonical auth worker. Cross-domain
// OAuth is explicitly supported by ChatGPT (see OpenAI apps-sdk auth docs).
// The `resource` field is the canonical identifier of the protected
// resource — the MCP endpoint URL (`<origin>/mcp`), the same URL clients
// configure as the MCP server. Clients send it as the OAuth `resource`
// parameter and it lands verbatim in the token audience, so validate.ts
// accepts both the origin and the endpoint form.
function protectedResourceHandler(request: Request, env: Env): Response {
  const origin = originFrom(request.url);
  return Response.json({
    resource: `${origin}/mcp`,
    authorization_servers: [authUrl(env)],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'tools'],
    bearer_methods_supported: ['header'],
    resource_parameter_supported: true,
  });
}

// RFC 8414: Authorization Server Metadata
// Served on the MCP server as a fallback for clients that try
// /.well-known/oauth-authorization-server on the MCP server directly
// instead of following the protected-resource → authorization_servers chain.
// All endpoint URLs point to the canonical auth server for this environment.
function authorizationServerHandler(env: Env): Response {
  const authServer = authUrl(env);
  return Response.json({
    issuer: authServer,
    authorization_endpoint: `${authServer}/authorize`,
    token_endpoint: `${authServer}/token`,
    revocation_endpoint: `${authServer}/revoke`,
    registration_endpoint: `${authServer}/register`,
    jwks_uri: `${authServer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'tools'],
    require_pkce: true,
    resource_parameter_supported: true,
  });
}

// OIDC discovery document fallback, for clients that probe the MCP server
// directly for /.well-known/openid-configuration.
function openidConfigurationHandler(env: Env): Response {
  const authServer = authUrl(env);
  return Response.json({
    issuer: authServer,
    authorization_endpoint: `${authServer}/authorize`,
    token_endpoint: `${authServer}/token`,
    userinfo_endpoint: `${authServer}/userinfo`,
    revocation_endpoint: `${authServer}/revoke`,
    end_session_endpoint: `${authServer}/end_session`,
    registration_endpoint: `${authServer}/register`,
    jwks_uri: `${authServer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'tools'],
    require_pkce: true,
    resource_parameter_supported: true,
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
    response = protectedResourceHandler(request, env);
  } else if (authPaths.includes(pathname)) {
    response = authorizationServerHandler(env);
  } else if (openidPaths.includes(pathname)) {
    response = openidConfigurationHandler(env);
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
