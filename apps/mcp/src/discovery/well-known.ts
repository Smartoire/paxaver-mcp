/**
 * Well-known discovery endpoints (RFC 9728, RFC 8414) and ChatGPT domain verification.
 *
 * OAuth is delegated to the centralized auth worker (auth.paxaver.com).
 * The MCP server is a resource server, not an authorization server.
 */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env.js';

export const wellKnownApp = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// No-cache headers for all well-known endpoints so CDN and clients
// always get fresh metadata.
wellKnownApp.use('/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, max-age=0');
});

// ChatGPT Marketplace — domain verification
wellKnownApp.get('/.well-known/openai-apps-challenge', (c) => {
  const token = c.env.CHATGPT_VERIFY_TOKEN;
  if (!token) return c.text('Not configured', 404);
  return c.text(token, 200, { 'Content-Type': 'text/plain' });
});

// RFC 9728: Protected Resource Metadata
// Points to the auth worker as the authorization server. Cross-domain
// OAuth is explicitly supported by ChatGPT (see OpenAI apps-sdk auth docs).
// The `resource` field MUST match the MCP endpoint URL that ChatGPT
// connects to (including the /mcp path), not just the origin.
function protectedResourceHandler(c: any) {
  const origin = new URL(c.req.url).origin.replace(/^http:/, 'https:');
  const authServer = authServerUrl(c.env);
  return c.json({
    resource: `${origin}/mcp`,
    authorization_servers: [authServer],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'tools'],
    bearer_methods_supported: ['header'],
    resource_parameter_supported: true,
  });
}

// RFC 8414: Authorization Server Metadata
// Served on the MCP server as a fallback for clients that try
// /.well-known/oauth-authorization-server on the MCP server directly
// instead of following the protected-resource → authorization_servers chain.
// All endpoint URLs point to the real auth server (auth.paxaver.com).
function authorizationServerHandler(c: any) {
  const authServer = authServerUrl(c.env);
  return c.json({
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

function authServerUrl(env: any): string {
  if (env.ENVIRONMENT === 'development') return 'http://localhost:8788';
  if (env.ENVIRONMENT === 'staging') return 'https://auth.paxaver.dev';
  return 'https://auth.paxaver.com';
}

// RFC 9728 discovery: the well-known URL is derived by inserting
// /.well-known/oauth-protected-resource between the host and the path.
// For resource https://mcp.paxaver.com/mcp, the metadata URL is
// https://mcp.paxaver.com/.well-known/oauth-protected-resource/mcp.
// We also serve at /.well-known/ (no path suffix) and /mcp/.well-known/
// for clients that use different discovery strategies.
wellKnownApp.get('/.well-known/oauth-protected-resource', protectedResourceHandler);
wellKnownApp.get('/.well-known/oauth-protected-resource/mcp', protectedResourceHandler);
wellKnownApp.get('/.well-known/oauth-authorization-server', authorizationServerHandler);
wellKnownApp.get('/.well-known/oauth-authorization-server/mcp', authorizationServerHandler);
wellKnownApp.get('/mcp/.well-known/oauth-protected-resource', protectedResourceHandler);
wellKnownApp.get('/mcp/.well-known/oauth-authorization-server', authorizationServerHandler);

// OAuth callback relay page.
// Receives the authorization code from the auth worker redirect,
// relays it to the MCP Inspector (or other AI client) via postMessage,
// and shows a manual copy fallback for guided flows.
wellKnownApp.get('/oauth/callback', (c) => {
  const code = c.req.query('code') ?? '';
  const state = c.req.query('state') ?? '';
  const error = c.req.query('error') ?? '';
  const errorDescription = c.req.query('error_description') ?? '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paxaver MCP — OAuth Callback</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#1a1a1a}
  h1{font-size:20px;margin:0 0 16px}
  .code-box{background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:16px;font-family:monospace;font-size:14px;word-break:break-all;margin:16px 0}
  .error{color:#dc2626}
  .hint{color:#71717a;font-size:14px;margin-top:24px}
  button{background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer}
  button:hover{background:#1d4ed8}
</style>
</head>
<body>
<div id="content"></div>
<script>
(function(){
  var data = { type: 'oauth_callback', code: ${JSON.stringify(code)}, state: ${JSON.stringify(state)}, error: ${JSON.stringify(error)}, error_description: ${JSON.stringify(errorDescription)} };

  // Relay to opener (MCP Inspector popup flow). The opener is typically
  // cross-origin, so we can't read its origin directly — instead we post to
  // each allowed origin; the browser only delivers to the one matching the
  // opener's actual origin. Never use '*' as targetOrigin: the payload
  // contains the authorization code. Unknown openers fall through to the
  // manual copy UI below.
  var ALLOWED_OPENER_ORIGINS = [
    'https://inspector.modelcontextprotocol.io',
    'https://chatgpt.com',
    'https://chat.openai.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ];
  if (window.opener) {
    for (var i = 0; i < ALLOWED_OPENER_ORIGINS.length; i++) {
      try { window.opener.postMessage(data, ALLOWED_OPENER_ORIGINS[i]); } catch(e) {}
    }
  }

  var el = document.getElementById('content');
  if (data.error) {
    el.innerHTML = '<h1 class="error">Authorization failed</h1>' +
      '<p><strong>' + escapeHtml(data.error) + '</strong></p>' +
      (data.error_description ? '<p>' + escapeHtml(data.error_description) + '</p>' : '');
  } else if (data.code) {
    el.innerHTML = '<h1>Authorization successful</h1>' +
      '<p>Copy this code and paste it into the MCP Inspector Auth Debugger:</p>' +
      '<div class="code-box" id="code">' + escapeHtml(data.code) + '</div>' +
      '<button onclick="copyCode()">Copy code</button>' +
      '<p class="hint">If the MCP Inspector opened this page in a popup, the code was sent automatically. You can close this window.</p>';
  } else {
    el.innerHTML = '<h1>OAuth Callback</h1><p>No authorization code or error received.</p>';
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  window.copyCode = function() {
    var code = document.getElementById('code').textContent;
    navigator.clipboard.writeText(code).then(function() {
      var btn = document.querySelector('button');
      btn.textContent = 'Copied!';
    });
  };
})();
</script>
</body>
</html>`;

  return c.html(html);
});

// NOTE: Do NOT add /oauth or /oauth/ redirect endpoints. A 302 redirect
// from mcp.paxaver.com to auth.paxaver.com causes ChatGPT's safety scanner
// to reject the discovery with "Unsafe URL". All OAuth metadata is served
// directly on this domain via the /.well-known/ endpoints above.
