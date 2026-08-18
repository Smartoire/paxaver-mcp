/**
 * MCP JSON-RPC 2.0 handler and tool dispatcher.
 *
 * Auth is re-validated on every request (stateless). Tool authorization
 * is enforced via the capability policy table before dispatch. The actual
 * business logic runs in the backend via the service-binding API client.
 */

import { PROTOCOL_VERSION } from "../transport/streamable-http.js";
import {
  canSeeTool,
  checkToolAuthorization,
  getToolPolicy,
  TOOL_POLICIES,
} from "../lib/policy.js";
import { ALL_TOOLS } from "../schemas/index.js";
import { dispatchTool } from "../tools/dispatch.js";
import { mcpError, type RpcRequest } from "../lib/errors.js";

// ponytail: Hono's Context generic is complex and varies by route path.
// The fields we use (env, var, req.header, url) are stable across all
// routes. Ceiling = no compile-time check that callers pass a real Hono
// context; upgrade path = use Hono's generic Context<Env, AppVariables>.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function handleJsonRpc(
  c: any,
  req: RpcRequest,
): Promise<Response> {
  const { method, params, id } = req;

  // notifications/initialized is the only unauthenticated notification
  if (method === "notifications/initialized") {
    return Response.json({ jsonrpc: "2.0", id: id ?? null, result: {} });
  }

  // ping is authenticated but has no params
  if (method === "ping") {
    return Response.json({ jsonrpc: "2.0", id, result: {} });
  }

  if (method === "initialize") {
    const ctx = c.var;
    const admin =
      ctx.isPlatformAdmin ||
      ctx.permissions.includes("school_master") ||
      ctx.permissions.includes("pac_member");
    return Response.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
        },
        serverInfo: {
          name: "paxaver-mcp",
          version: "2.1.1",
          title: "Paxaver MCP",
          description:
            "School community operations: ordering, wallet, menus, events, fundraising, and school management.",
        },
        instructions: admin
          ? "Paxaver connects school community accounts. ALWAYS call get_user_info first to establish context. For lunch menu questions use get_daily_menu (accepts 'date' YYYY-MM-DD or 'month' YYYY-MM). To order lunch use order_lunch (needs menu_item_id from get_daily_menu and menu_date). Admin tools: list_school_restaurants, create_restaurant, list_menu_items, create_menu_item, update_menu_item, delete_menu_item, set_daily_menu, get_daily_orders. Do not invent tool names - use only the tools returned by tools/list."
          : "Paxaver connects school community accounts. ALWAYS call get_user_info first to establish context. For lunch menu questions use get_daily_menu (accepts 'date' YYYY-MM-DD or 'month' YYYY-MM). To order lunch use order_lunch (needs menu_item_id from get_daily_menu and menu_date). Do not invent tool names - use only the tools returned by tools/list.",
      },
    });
  }

  if (method === "tools/list") {
    const ctx = c.var;
    const visibleTools = ALL_TOOLS.filter((t) => canSeeTool(t.name, ctx));
    return Response.json({
      jsonrpc: "2.0",
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

  if (method === "tools/call") {
    const toolName = params?.name as string;
    const toolArgs = (params?.arguments as Record<string, unknown>) || {};

    if (!TOOL_POLICIES[toolName]) {
      return Response.json(mcpError(id, -32601, `Unknown tool: ${toolName}`));
    }

    const authResult = checkToolAuthorization(toolName, c.var);
    if (authResult === "forbidden") {
      return Response.json(
        mcpError(id, -32603, "You do not have permission to use this tool."),
      );
    }

    return dispatchTool(c, toolName, toolArgs, id);
  }

  if (method === "resources/list") {
    return Response.json({ jsonrpc: "2.0", id, result: { resources: [] } });
  }

  if (method === "resources/read") {
    return Response.json(mcpError(id, -32602, "No resources available."));
  }

  if (method === "prompts/list") {
    return Response.json({ jsonrpc: "2.0", id, result: { prompts: [] } });
  }

  return Response.json(mcpError(id, -32601, `Method not found: ${method}`));
}
