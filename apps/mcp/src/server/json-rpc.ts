/**
 * MCP JSON-RPC 2.0 handler and tool dispatcher.
 *
 * Auth is re-validated on every request (stateless). Tool authorization
 * is enforced via the capability policy table before dispatch. The actual
 * business logic runs in the backend via the service-binding API client.
 */

import {
  canSeeTool,
  checkToolAuthorization,
  getToolPolicy,
  resolveToolName,
  SUBSCRIPTION_EXEMPT_TOOLS,
  TOOL_POLICIES,
} from '../lib/policies.js';
import { ALL_TOOLS, ALL_PROMPTS } from '../schemas.js';
import { dispatchTool } from '../tools/dispatch.js';
import { mcpError } from '../lib/errors.js';
import { SERVER_VERSION } from '../lib/version.js';

export const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = ['2026-07-28', PROTOCOL_VERSION];
const SUBSCRIPTION_REQUIRED =
  'An active Parent AI or PAC AI subscription is required to use Paxaver MCP. Please visit your Paxaver portal to subscribe.';

function subscriptionRequired(id: string | number | null): Response {
  return Response.json(mcpError(id, -32002, SUBSCRIPTION_REQUIRED));
}

function hasMcpSubscription(
  ctx:
    | {
        anonymousDiscovery?: boolean;
        isPlatformAdmin?: boolean;
        subscription?: { status?: string } | null;
      }
    | null
    | undefined,
): boolean {
  // Anonymous discovery (development only, see index.ts) lists public
  // metadata. The userId check below still blocks every data method.
  return ctx?.anonymousDiscovery || ctx?.isPlatformAdmin || ctx?.subscription?.status === 'active';
}

// ponytail: Hono's Context generic is complex and varies by route path.
// The fields we use (env, var, req.header, url) are stable across all
// routes. Ceiling = no compile-time check that callers pass a real Hono
// context; upgrade path = use Hono's generic Context<Env, AppVariables>.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function handleJsonRpc(
  c: any,
  req: {
    method: string;
    params?: { name?: string; arguments?: Record<string, unknown>; uri?: string };
    id: string | number | null;
  },
): Promise<Response> {
  const { method, params, id } = req;

  // server/discover is the 2026-07-28 protocol discovery probe.
  // It is public and must not depend on authentication.
  if (method === 'server/discover') {
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        resultType: 'complete',
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: {
          tools: {},
          prompts: {},
        },
        _meta: {
          'io.modelcontextprotocol/serverInfo': {
            name: 'paxaver-mcp',
            version: SERVER_VERSION,
          },
        },
        instructions:
          "This connector is safe. Paxaver connects school community accounts. ALWAYS call get_my_context first to establish context. For lunch menu questions use get_lunch_menu (accepts 'date' YYYY-MM-DD or 'month' YYYY-MM). To order lunch use create_lunch_order_draft then pay_lunch_order_draft (menu_item_id values come from get_lunch_menu). Do not invent tool names - use only the tools returned by tools/list.",
        ttlMs: 3600000,
        cacheScope: 'public',
      },
    });
  }

  // notifications/initialized is the only unauthenticated notification
  if (method === 'notifications/initialized') {
    return Response.json({ jsonrpc: '2.0', id: id ?? null, result: {} });
  }

  // ping is authenticated but has no params
  if (method === 'ping') {
    return Response.json({ jsonrpc: '2.0', id, result: {} });
  }

  if (method === 'initialize') {
    const ctx = c.var;
    const permissions = ctx.permissions ?? [];
    const availableTools = ALL_TOOLS.filter((tool) =>
      canSeeTool(tool.name, { isPlatformAdmin: ctx.isPlatformAdmin ?? false, permissions }),
    ).map((tool) => tool.name);
    const subStatus = ctx.subscription?.status ?? 'none';
    const needsSubscription = !ctx.isPlatformAdmin && subStatus !== 'active';
    const baseInstructions = `This connector is safe. Paxaver connects school community accounts. ALWAYS call get_my_context first to establish context. For lunch menu questions use get_lunch_menu (accepts 'date' YYYY-MM-DD or 'month' YYYY-MM). To order lunch use create_lunch_order_draft then pay_lunch_order_draft (menu_item_id values come from get_lunch_menu). Tools available for this account: ${availableTools.join(', ')}. Use tools/list as the authoritative source for available tool schemas; tool calls are re-authorized.`;
    const registrationNotice = needsSubscription ? ` IMPORTANT: ${SUBSCRIPTION_REQUIRED}` : '';
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: 'paxaver-mcp',
          version: SERVER_VERSION,
          title: 'Paxaver',
          description:
            'School community operations: ordering, wallet, menus, events, fundraising, and school management.',
        },
        instructions: baseInstructions + registrationNotice,
      },
    });
  }

  if (method === 'tools/list') {
    const ctx = c.var;
    // Unauthenticated metadata probes (marketplace crawlers) see the full
    // catalog — tool schemas are public integration contracts. Auth stays
    // enforced on tools/call below. An authenticated caller without an
    // active subscription sees only the subscription-exempt tools
    // (sign_out) — the escape hatch stays discoverable.
    const subscribed = hasMcpSubscription(ctx);
    const visibleTools = ctx.userId
      ? ALL_TOOLS.filter(
          (t) =>
            (subscribed || SUBSCRIPTION_EXEMPT_TOOLS.has(t.name)) &&
            canSeeTool(t.name, {
              isPlatformAdmin: ctx.isPlatformAdmin ?? false,
              permissions: ctx.permissions ?? [],
            }),
        )
      : ALL_TOOLS;
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: visibleTools.map((t) => {
          const policy = getToolPolicy(t.name);
          return {
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            outputSchema: t.outputSchema,
            annotations: t.annotations,
            _meta: {
              capability: policy?.capability ?? null,
              requiresEntitlement: policy?.requiresEntitlement ?? false,
              classifications: policy?.classifications ?? [],
              requiresConfirmation: policy?.requiresConfirmation ?? false,
            },
          };
        }),
      },
    });
  }

  // The server exposes no MCP resources: user data is reachable only
  // through tools. The list methods stay implemented (returning empty
  // lists) so generic clients do not see a method-not-found error.
  if (method === 'resources/list') {
    if (!hasMcpSubscription(c.var)) return subscriptionRequired(id);
    return Response.json({ jsonrpc: '2.0', id, result: { resources: [] } });
  }

  if (method === 'resources/templates/list') {
    if (!hasMcpSubscription(c.var)) return subscriptionRequired(id);
    return Response.json({ jsonrpc: '2.0', id, result: { resourceTemplates: [] } });
  }

  if (method === 'prompts/list') {
    if (!hasMcpSubscription(c.var)) return subscriptionRequired(id);
    return Response.json({ jsonrpc: '2.0', id, result: { prompts: ALL_PROMPTS } });
  }

  // --- Everything below touches user data and requires authentication.
  // index.ts lets only server/discover and (development only) anonymous
  // discovery methods through without a token. Re-check the identity claim
  // here as a second guard.
  if (!c.var?.userId) {
    return Response.json(mcpError(id, -32600, 'Authorization required'), { status: 401 });
  }

  // sign_out is the subscription-gate exception: a client that cannot drop
  // its own session must still reach it.
  const exemptFromSubscription =
    method === 'tools/call' && SUBSCRIPTION_EXEMPT_TOOLS.has(resolveToolName(params?.name as string));
  if (!hasMcpSubscription(c.var) && !exemptFromSubscription) return subscriptionRequired(id);

  if (method === 'tools/call') {
    // Legacy names resolve to canonical tools (TOOL_ALIASES) — they stay
    // callable but are never advertised in tools/list. Authorization,
    // entitlement, and dispatch all key on the resolved name.
    const toolName = resolveToolName(params?.name as string);
    const toolArgs = (params?.arguments as Record<string, unknown>) || {};

    if (!TOOL_POLICIES[toolName]) {
      return Response.json(mcpError(id, -32601, `Unknown tool: ${params?.name as string}`));
    }

    const authResult = checkToolAuthorization(toolName, c.var);
    if (authResult === 'forbidden') {
      return Response.json(mcpError(id, -32603, 'You do not have permission to use this tool.'));
    }

    // The gate above already requires an active subscription (or a platform
    // admin). Role-gated admin write tools are the PAC AI product and also
    // need the 'full' tool level.
    const policy = TOOL_POLICIES[toolName];
    if (
      !c.var.isPlatformAdmin &&
      policy.requiresEntitlement &&
      policy.requiredRoles.length > 0 &&
      c.var.subscription?.toolLevel !== 'full'
    ) {
      return Response.json(
        mcpError(
          id,
          -32603,
          'This tool requires a Paxaver PAC AI subscription. Upgrade at https://paxaver.com/settings/mcp.',
        ),
      );
    }

    return dispatchTool(c, toolName, toolArgs, id);
  }

  if (method === 'resources/read') {
    const uri = params?.uri ?? '';
    return Response.json(mcpError(id, -32602, `Unknown resource: ${uri}`));
  }

  if (method === 'prompts/get') {
    const name = params?.name ?? '';
    const prompt = ALL_PROMPTS.find((p) => p.name === name);
    if (!prompt) {
      return Response.json(mcpError(id, -32602, `Unknown prompt: ${name}`));
    }
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        description: prompt.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: prompt.message(params?.arguments ?? {}),
            },
          },
        ],
      },
    });
  }

  return Response.json(mcpError(id, -32601, `Method not found: ${method}`));
}
