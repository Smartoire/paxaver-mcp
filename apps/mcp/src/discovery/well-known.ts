/**
 * Well-known discovery endpoints (RFC 9728, RFC 8414) and ChatGPT domain verification.
 *
 * OAuth is delegated to the centralized auth worker (auth.paxaver.com).
 * The MCP server is a resource server, not an authorization server.
 */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env.js';

export const wellKnownApp = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ChatGPT Marketplace — domain verification
wellKnownApp.get('/.well-known/openai-apps-challenge', (c) => {
  const token = c.env.CHATGPT_VERIFY_TOKEN;
  if (!token) return c.text('Not configured', 404);
  return c.text(token, 200, { 'Content-Type': 'text/plain' });
});

// RFC 9728: Protected Resource Metadata
// Points to the auth worker as the authorization server.
wellKnownApp.get('/.well-known/oauth-protected-resource', (c) => {
  const origin = new URL(c.req.url).origin.replace(/^http:/, 'https:');
  const authServer =
    c.env.ENVIRONMENT === 'development'
      ? 'http://localhost:8788'
      : c.env.ENVIRONMENT === 'staging'
        ? 'https://auth.paxaver.dev'
        : 'https://auth.paxaver.com';
  return c.json({
    resource: origin,
    authorization_servers: [authServer],
    scopes_supported: ['tools'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/Smartoire/paxaver-mcp/blob/main/docs/security.md',
  });
});

// RFC 8414: Authorization Server Metadata
// Delegates to the auth worker's OIDC discovery endpoint.
wellKnownApp.get('/.well-known/oauth-authorization-server', (c) => {
  const authServer =
    c.env.ENVIRONMENT === 'development'
      ? 'http://localhost:8788'
      : c.env.ENVIRONMENT === 'staging'
        ? 'https://auth.paxaver.dev'
        : 'https://auth.paxaver.com';
  return c.json({
    issuer: authServer,
    authorization_endpoint: `${authServer}/authorize`,
    token_endpoint: `${authServer}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email', 'tools', 'offline_access'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    jwks_uri: `${authServer}/.well-known/jwks.json`,
    service_documentation: `${authServer}/docs/authentication`,
  });
});

// Convenience redirects
wellKnownApp.get('/oauth', (c) => c.redirect('/.well-known/oauth-authorization-server', 302));
wellKnownApp.get('/oauth/', (c) => c.redirect('/.well-known/oauth-authorization-server', 302));
