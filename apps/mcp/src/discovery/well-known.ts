/**
 * Well-known discovery endpoints (RFC 9728, RFC 8414) and ChatGPT domain verification.
 *
 * OAuth is delegated to the centralized auth worker (auth.paxaver.com).
 * The MCP server is a resource server, not an authorization server.
 */

import type { Env } from '../env.js';
import { ALL_TOOLS, ALL_RESOURCES, ALL_PROMPTS } from '../schemas.js';
import { authUrl } from '../auth/validate.js';

function withCache(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function originFrom(url: string): string {
  return new URL(url).origin.replace(/^http:/, 'https:');
}

// RFC 9728: Protected Resource Metadata
// Points to the auth worker as the authorization server. Cross-domain
// OAuth is explicitly supported by ChatGPT (see OpenAI apps-sdk auth docs).
// The `resource` field MUST match the MCP endpoint URL that ChatGPT
// connects to (including the /mcp path), not just the origin.
function protectedResourceHandler(request: Request, env: Env): Response {
  const origin = originFrom(request.url);
  const authServer = authUrl(env);
  return Response.json({
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

function serverCardHandler(request: Request): Response {
  const origin = originFrom(request.url);
  return Response.json({
    serverInfo: {
      name: 'paxaver-mcp',
      version: '2.1.5',
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

function openaiChallengeHandler(request: Request, env: Env): Response {
  const token = env.CHATGPT_VERIFY_TOKEN;
  if (!token) return new Response('Not configured', { status: 404 });
  return new Response(token, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

function oauthCallbackHandler(request: Request): Response {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const error = url.searchParams.get('error') ?? '';
  const errorDescription = url.searchParams.get('error_description') ?? '';

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

  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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

  if (pathname === '/.well-known/openai-apps-challenge') {
    return withCache(openaiChallengeHandler(request, env));
  }
  if (protectedPaths.includes(pathname)) {
    return withCache(protectedResourceHandler(request, env));
  }
  if (authPaths.includes(pathname)) {
    return withCache(authorizationServerHandler(env));
  }
  if (pathname === '/.well-known/mcp/server-card.json') {
    return withCache(serverCardHandler(request));
  }
  if (pathname === '/oauth/callback') {
    return withCache(oauthCallbackHandler(request));
  }
  if (pathname === '/oauth' || pathname === '/oauth/') {
    return withCache(new Response('Not found', { status: 404 }));
  }

  return withCache(new Response('Not found', { status: 404 }));
}

// Test helper that matches the shape of Hono's app.request(path, init, env)
async function request(path: string, init: RequestInit = {}, env: Record<string, unknown>): Promise<Response> {
  const req = new Request(new URL(path, 'http://localhost'), init);
  return wellKnownFetch(req, env as unknown as Env);
}

export const wellKnownApp = { fetch: wellKnownFetch, request };
export default wellKnownApp;
