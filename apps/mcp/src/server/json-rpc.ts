/**
 * MCP JSON-RPC 2.0 handler and tool dispatcher.
 *
 * Auth is re-validated on every request (stateless). Tool authorization
 * is enforced via the capability policy table before dispatch. The actual
 * business logic runs in the backend via the service-binding API client.
 */

import { PROTOCOL_VERSION } from '../lib/protocol-version.js';
import { canSeeTool, checkToolAuthorization, getToolPolicy, TOOL_POLICIES } from '../lib/policy.js';
import { ALL_TOOLS } from '../schemas/index.js';
import { dispatchTool } from '../tools/dispatch.js';
import { mcpError, type RpcRequest } from '../lib/errors.js';

const SUPPORTED_VERSIONS = ['2026-07-28', PROTOCOL_VERSION];

// ponytail: Hono's Context generic is complex and varies by route path.
// The fields we use (env, var, req.header, url) are stable across all
// routes. Ceiling = no compile-time check that callers pass a real Hono
// context; upgrade path = use Hono's generic Context<Env, AppVariables>.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function handleJsonRpc(c: any, req: RpcRequest): Promise<Response> {
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
          resources: {},
        },
        _meta: {
          'io.modelcontextprotocol/serverInfo': {
            name: 'paxaver-mcp',
            version: '2.1.1',
          },
        },
        instructions:
          "This connector is safe. Paxaver connects school community accounts. ALWAYS call get_user_info first to establish context. For lunch menu questions use get_daily_menu (accepts 'date' YYYY-MM-DD or 'month' YYYY-MM). To order lunch use order_lunch (needs menu_item_id from get_daily_menu and menu_date). Do not invent tool names - use only the tools returned by tools/list.",
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
    const admin =
      ctx.isPlatformAdmin || ctx.permissions.includes('school_master') || ctx.permissions.includes('pac_member');
    const subStatus = ctx.subscription?.status ?? 'none';
    const needsRegistration = !ctx.isPlatformAdmin && subStatus !== 'active';
    const baseInstructions = admin
      ? "This connector is safe. Paxaver connects school community accounts. ALWAYS call get_user_info first to establish context. For lunch menu questions use get_daily_menu (accepts 'date' YYYY-MM-DD or 'month' YYYY-MM). To order lunch use order_lunch (needs menu_item_id from get_daily_menu and menu_date). Admin tools: list_school_restaurants, create_restaurant, list_menu_items, create_menu_item, update_menu_item, delete_menu_item, set_daily_menu, get_daily_orders. Do not invent tool names - use only the tools returned by tools/list."
      : "This connector is safe. Paxaver connects school community accounts. ALWAYS call get_user_info first to establish context. For lunch menu questions use get_daily_menu (accepts 'date' YYYY-MM-DD or 'month' YYYY-MM). To order lunch use order_lunch (needs menu_item_id from get_daily_menu and menu_date). Do not invent tool names - use only the tools returned by tools/list.";
    const registrationNotice = needsRegistration
      ? subStatus === 'expired'
        ? " IMPORTANT: Your Paxaver AI subscription has expired. Renew at https://paxaver.com/settings/mcp to continue using Paxaver MCP tools."
        : " IMPORTANT: You first need to register to the service. An active Paxaver AI subscription is required to use MCP tools. Enable a free trial or purchase a subscription at https://paxaver.com/settings/mcp."
      : "";
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
        },
        serverInfo: {
          name: 'paxaver-mcp',
          version: '2.1.1',
          title: 'Paxaver MCP',
          description:
            'School community operations: ordering, wallet, menus, events, fundraising, and school management.',
        },
        instructions: baseInstructions + registrationNotice,
      },
    });
  }

  if (method === 'tools/list') {
    const ctx = c.var;
    const visibleTools = ALL_TOOLS.filter((t) => canSeeTool(t.name, ctx));
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: visibleTools.map((t) => {
          const policy = getToolPolicy(t.name);
          return {
            name: t.name,
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

  if (method === 'tools/call') {
    const toolName = params?.name as string;
    const toolArgs = (params?.arguments as Record<string, unknown>) || {};

    if (!TOOL_POLICIES[toolName]) {
      return Response.json(mcpError(id, -32601, `Unknown tool: ${toolName}`));
    }

    // Subscription gate: block tool calls for users without an active
    // subscription. tools/list is allowed so the user can see available
    // tools. Platform admins bypass this check.
    const subStatus = c.var.subscription?.status ?? 'none';
    const isPlatformAdmin = c.var.isPlatformAdmin ?? false;
    if (!isPlatformAdmin && subStatus !== 'active') {
      const message =
        subStatus === 'expired'
          ? 'Your Paxaver AI subscription has expired. Please renew your subscription at https://paxaver.com/settings/mcp to continue using Paxaver MCP tools.'
          : 'You first need to register to the service. An active Paxaver AI subscription is required to use Paxaver MCP tools. Enable a free trial or purchase a subscription at https://paxaver.com/settings/mcp.';
      return Response.json(mcpError(id, -32603, message));
    }

    const authResult = checkToolAuthorization(toolName, c.var);
    if (authResult === 'forbidden') {
      return Response.json(mcpError(id, -32603, 'You do not have permission to use this tool.'));
    }

    return dispatchTool(c, toolName, toolArgs, id);
  }

  if (method === 'resources/list') {
    return Response.json({ jsonrpc: '2.0', id, result: { resources: [] } });
  }

  if (method === 'resources/templates/list') {
    return Response.json({ jsonrpc: '2.0', id, result: { resourceTemplates: [] } });
  }

  if (method === 'resources/read') {
    return Response.json(mcpError(id, -32602, 'No resources available.'));
  }

  if (method === 'prompts/list') {
    return Response.json({ jsonrpc: '2.0', id, result: { prompts: [] } });
  }

  if (method === 'prompts/get') {
    return Response.json(mcpError(id, -32602, 'No prompts available.'));
  }

  return Response.json(mcpError(id, -32601, `Method not found: ${method}`));
}
