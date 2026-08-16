import type { ToolDefinition } from './index.js';

export const restaurantTools: ToolDefinition[] = [
  {
    name: 'list_school_restaurants',
    description:
      'ADMIN: Lists restaurants for the active school. Requires school_master, pac_member, or lunch_cordinator role. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { school_slug: { type: 'string', description: 'School slug (defaults to active school)' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'List School Restaurants (Admin)' },
  },
  {
    name: 'create_restaurant',
    description:
      'ADMIN: Creates a restaurant for the active school. Requires school_master role. WRITE operation — confirm with the user.',
    inputSchema: {
      type: 'object',
      properties: {
        school_slug: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        tax_percent: { type: 'number' },
      },
      required: ['name'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Create Restaurant (Admin)' },
  },
  {
    name: 'list_menu_items',
    description:
      'ADMIN: Lists menu items for a restaurant. Requires school_master or lunch_cordinator role. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { restaurant_id: { type: 'string' } },
      required: ['restaurant_id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'List Menu Items (Admin)' },
  },
  {
    name: 'create_menu_item',
    description:
      'ADMIN: Creates a menu item for a restaurant. Requires school_master or lunch_cordinator role. WRITE operation.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        cost_cents: { type: 'integer' },
        price_cents: { type: 'integer' },
        ingredients: { type: 'string' },
        calories: { type: 'integer' },
      },
      required: ['restaurant_id', 'name'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Create Menu Item (Admin)' },
  },
  {
    name: 'update_menu_item',
    description:
      'ADMIN: Updates a menu item. Requires school_master or lunch_cordinator role. WRITE operation.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string' },
        menu_item_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        cost_cents: { type: 'integer' },
        ingredients: { type: 'string' },
        calories: { type: 'integer' },
        is_active: { type: 'boolean' },
        price_cents: { type: 'integer' },
        is_available: { type: 'boolean' },
      },
      required: ['restaurant_id', 'menu_item_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Update Menu Item (Admin)' },
  },
  {
    name: 'set_menu_item_price',
    description:
      'ADMIN: Sets the price of a menu item. Requires school_master or lunch_cordinator role. FINANCIAL + WRITE operation — confirm the new price with the user.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string' },
        menu_item_id: { type: 'string' },
        price_cents: { type: 'integer', description: 'New price in cents' },
      },
      required: ['restaurant_id', 'menu_item_id', 'price_cents'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Set Menu Item Price (Admin)' },
  },
  {
    name: 'delete_menu_item',
    description:
      'ADMIN: Soft-deletes a menu item. Requires school_master or lunch_cordinator role. DESTRUCTIVE operation — confirm with the user.',
    inputSchema: {
      type: 'object',
      properties: { restaurant_id: { type: 'string' }, menu_item_id: { type: 'string' } },
      required: ['restaurant_id', 'menu_item_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, title: 'Delete Menu Item (Admin)' },
  },
  {
    name: 'set_daily_menu',
    description:
      'ADMIN: Sets the daily menu (assigns a menu item to a date with available quantity). Requires school_master or lunch_cordinator role. WRITE operation.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string' },
        menu_item_id: { type: 'string' },
        menu_date: { type: 'string', description: 'YYYY-MM-DD' },
        available_qty: { type: 'integer' },
      },
      required: ['restaurant_id', 'menu_item_id', 'menu_date'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Set Daily Menu (Admin)' },
  },
];
