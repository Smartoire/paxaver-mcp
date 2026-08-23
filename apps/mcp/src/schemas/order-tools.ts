import type { ToolDefinition } from './index.js';

export const orderTools: ToolDefinition[] = [
  {
    name: 'order_lunch',
    description:
      "Places a lunch order for a student the authenticated user is a guardian of. Requires menu_item_id (from get_daily_menu) and menu_date (YYYY-MM-DD). Optionally specify student_id (defaults to the user's first student if only one). Payment is deducted from the wallet. This is a FINANCIAL + WRITE operation — always confirm the order details (student, item, date, quantity) with the user before calling. Idempotent: duplicate calls with the same idempotency context will not create duplicate orders.",
    inputSchema: {
      type: 'object',
      properties: {
        student_id: { type: 'string', description: 'Student ID (must be your own student; from get_user_info)' },
        menu_item_id: { type: 'string', description: 'Menu item ID from get_daily_menu' },
        menu_date: { type: 'string', description: 'YYYY-MM-DD' },
        quantity: { type: 'integer', description: 'Number of servings (default 1)', minimum: 1, default: 1 },
      },
      required: ['menu_item_id', 'menu_date'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Order Lunch' },
  },
  {
    name: 'get_orders',
    description:
      "Returns recent lunch orders for the authenticated user's students. Read-only. Optionally filter by student_id.",
    inputSchema: {
      type: 'object',
      properties: {
        student_id: { type: 'string', description: 'Filter to a specific student (must be your own)' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Orders' },
  },
  {
    name: 'get_daily_menu',
    description:
      'Returns the daily lunch menu for the user\'s active school. Accepts either "date" (YYYY-MM-DD) or "month" (YYYY-MM). If neither is given, returns today\'s menu. Read-only. Use this to find menu_item_id values for order_lunch.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        month: { type: 'string', description: 'YYYY-MM' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Daily Menu' },
  },
  {
    name: 'get_updates',
    description:
      'Returns a summary of recent activity: wallet balance, recent orders, upcoming events. Read-only. Use this for a quick overview.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Updates' },
  },
  {
    name: 'get_daily_orders',
    description:
      'ADMIN: Returns all orders for the active school on a given date. Requires school_master or lunch_cordinator role. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { menu_date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['menu_date'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: 'Get Daily Orders (Admin)',
    },
  },
  {
    name: 'get_monthly_orders',
    description: 'Returns a monthly summary of orders. Optionally filter by month (YYYY-MM) and student. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM' },
        student_id: { type: 'string', description: 'Filter to a specific student (must be your own)' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Monthly Orders' },
  },
  {
    name: 'get_published_menu',
    description:
      "Returns the published daily lunch menu for the user's active school. Accepts either 'date' (YYYY-MM-DD) or 'month' (YYYY-MM). If neither is given, returns today's menu. Read-only. Use this to find menu_item_id values for create_draft_order.",
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        month: { type: 'string', description: 'YYYY-MM' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Published Menu' },
  },
  {
    name: 'create_draft_order',
    description:
      'Creates a draft lunch order for a student. Requires student_id, school_slug, menu_date, and items array. Each item needs menu_item_id, menu_item_name, price_cents, and quantity. The draft is not finalized — call finalize_order to commit the order and deduct payment. This is a FINANCIAL + WRITE operation — always confirm the order details with the user before calling. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        student_id: { type: 'string', description: 'Student ID' },
        school_slug: { type: 'string', description: 'School slug' },
        menu_date: { type: 'string', description: 'YYYY-MM-DD' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              menu_item_id: { type: 'string' },
              menu_item_name: { type: 'string' },
              price_cents: { type: 'integer' },
              quantity: { type: 'integer', minimum: 1 },
            },
            required: ['menu_item_id', 'menu_item_name', 'price_cents', 'quantity'],
          },
        },
      },
      required: ['student_id', 'school_slug', 'menu_date', 'items'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Create Draft Order' },
  },
  {
    name: 'finalize_order',
    description:
      "Finalizes a draft order, deducting payment from the wallet. Optionally include tip_cents (donated to the school's PAC). This is a FINANCIAL + WRITE operation — always confirm with the user before calling. Idempotent.",
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID from create_draft_order' },
        tip_cents: { type: 'integer', description: 'Tip in cents (donated to school PAC)', default: 0 },
      },
      required: ['order_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Finalize Order' },
  },
  {
    name: 'cancel_order',
    description:
      'Cancels a finalized order if labels have not been sent yet. Refunds the wallet. This is a DESTRUCTIVE operation — always confirm with the user before cancelling. If labels have already been sent, the cancellation will be rejected. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID to cancel' },
      },
      required: ['order_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, title: 'Cancel Order' },
  },
];
