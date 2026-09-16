/**
 * Tool, resource, and prompt schema registry. Each tool has name,
 * description, inputSchema, outputSchema, and annotations. The
 * authorization policy lives in lib/policies.ts.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: false;
  };
  outputSchema?: {
    type: 'object';
    properties: Record<string, unknown>;
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    title?: string;
  };
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: PromptArgument[];
}

export const ALL_TOOLS: ToolDefinition[] = [
  // --- User/account ---
  {
    name: 'get_user_info',
    description:
      'Returns the authenticated Paxaver user context: their first name, active school, students they are a guardian for, and available roles. ALWAYS call this first before any other tool to establish context. This is a read-only operation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        firstName: { type: ['string', 'null'] },
        schoolSlug: { type: ['string', 'null'] },
        schoolName: { type: ['string', 'null'] },
        students: { type: 'array', items: { type: 'object' } },
        roles: { type: 'array', items: { type: 'string' } },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get User Info' },
  },
  // --- Wallet ---
  {
    name: 'get_wallet_balance',
    description:
      'Returns the current wallet balance for the authenticated user at their active school. Read-only. Use this to check funds before ordering lunch.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        balanceCents: { type: ['number', 'null'] },
        balanceFormatted: { type: ['string', 'null'] },
        currency: { type: ['string', 'null'] },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Wallet Balance' },
  },
  {
    name: 'get_wallet_status',
    description:
      'Returns the wallet balance plus recent transactions and pending deposits. Read-only. Use this for a wallet overview.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        balanceCents: { type: ['number', 'null'] },
        balance: { type: ['string', 'null'] },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              amountCents: { type: 'integer' },
              description: { type: ['string', 'null'] },
              createdAt: { type: 'string' },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Wallet Status' },
  },
  // --- Orders ---
  {
    name: 'order_lunch',
    description:
      "Places a lunch order for a student the authenticated user is a guardian of. Requires menu_item_id (from get_daily_menu) and menu_date (YYYY-MM-DD). Optionally specify student_id (defaults to the user's first student if only one). Payment is deducted from the wallet. This is a FINANCIAL + WRITE operation - always confirm the order details (student, item, date, quantity) with the user before calling. Idempotent: duplicate calls with the same idempotency context will not create duplicate orders.",
    inputSchema: {
      type: 'object',
      properties: {
        student_id: { type: 'string', description: 'Student ID (must be your own student; from get_user_info)' },
        menu_item_id: { type: 'string', description: 'Menu item ID from get_daily_menu' },
        menu_date: { type: 'string', description: 'YYYY-MM-DD' },
        quantity: { type: 'integer', description: 'Number of servings (default 1)', minimum: 1, default: 1 },
      },
      required: ['menu_item_id', 'menu_date'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        studentId: { type: 'string' },
        schoolSlug: { type: 'string' },
        menuDate: { type: 'string' },
        status: { type: 'string' },
        itemTotalCents: { type: 'integer' },
        items: { type: 'array', items: { type: 'object' } },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Order Lunch' },
  },
  {
    name: 'get_orders',
    description:
      "Returns recent lunch orders for the authenticated user's students, including each order's items, menu date, status, and total. Optionally filter by student_id. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        student_id: { type: 'string', description: 'Filter to a specific student (must be your own)' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        orders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              studentId: { type: 'string' },
              menuDate: { type: 'string' },
              status: { type: 'string' },
              itemTotalCents: { type: 'integer' },
              items: { type: 'array', items: { type: 'object' } },
              createdAt: { type: 'string' },
            },
          },
        },
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
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        menuItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dailyMenuId: { type: 'string' },
              menuItemId: { type: 'string' },
              menuItemName: { type: 'string' },
              restaurantName: { type: ['string', 'null'] },
              priceCents: { type: 'integer' },
              availableQty: { type: ['integer', 'null'] },
              dietaryTags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Daily Menu' },
  },
  {
    name: 'get_daily_orders',
    description:
      'ADMIN: Returns all orders for the active school on a given date. Requires pac_cordinator or lunch_cordinator role. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { menu_date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['menu_date'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        orders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              studentId: { type: 'string' },
              menuDate: { type: 'string' },
              status: { type: 'string' },
              itemTotalCents: { type: 'integer' },
              items: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
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
    description:
      "Returns one row per lunch order placed in a calendar month — student, menu date, status, and item total — for the authenticated user's students. Optionally filter by month (YYYY-MM) and student. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM' },
        student_id: { type: 'string', description: 'Filter to a specific student (must be your own)' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        orders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              studentId: { type: 'string' },
              menuDate: { type: 'string' },
              status: { type: 'string' },
              itemTotalCents: { type: 'integer' },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Monthly Orders' },
  },
  {
    name: 'create_draft_order',
    description:
      'Creates a draft lunch order for a student. Requires student_id, school_slug, menu_date, and items array. Each item needs menu_item_id, menu_item_name, price_cents, and quantity. The draft is not finalized - call finalize_order to commit the order and deduct payment. This is a FINANCIAL + WRITE operation - always confirm the order details with the user before calling. Idempotent.',
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
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        studentId: { type: 'string' },
        schoolSlug: { type: 'string' },
        menuDate: { type: 'string' },
        status: { type: 'string' },
        itemTotalCents: { type: 'integer' },
        items: { type: 'array', items: { type: 'object' } },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Create Draft Order' },
  },
  {
    name: 'finalize_order',
    description:
      "Finalizes a draft order, deducting payment from the wallet. Optionally include tip_cents (donated to the school's PAC). This is a FINANCIAL + WRITE operation - always confirm with the user before calling. Idempotent.",
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID from create_draft_order' },
        tip_cents: { type: 'integer', description: 'Tip in cents (donated to school PAC)', default: 0 },
      },
      required: ['order_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
        itemTotalCents: { type: 'integer' },
        tipCents: { type: 'integer' },
        totalCents: { type: 'integer' },
        balanceCents: { type: ['number', 'null'] },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Finalize Order' },
  },
  {
    name: 'cancel_order',
    description:
      'Cancels a finalized order if labels have not been sent yet. Refunds the wallet. This is a DESTRUCTIVE operation - always confirm with the user before cancelling. If labels have already been sent, the cancellation will be rejected. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID to cancel' },
      },
      required: ['order_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
        refundCents: { type: 'integer' },
        balanceCents: { type: ['number', 'null'] },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, title: 'Cancel Order' },
  },

  // --- Events ---
  {
    name: 'get_upcoming_events',
    description:
      "Returns upcoming events for the user's active school, including each event's date, times, location, and closed status. Optionally filter by date range (start_date / end_date, YYYY-MM-DD). Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              eventDate: { type: 'string' },
              startsAt: { type: ['string', 'null'] },
              endsAt: { type: ['string', 'null'] },
              location: { type: ['string', 'null'] },
              isClosed: { type: 'boolean' },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Upcoming Events' },
  },
  {
    name: 'create_event',
    description:
      'ADMIN: Creates a school event. Requires pac_cordinator or event_cordinator role. This is a WRITE operation - confirm details with the user before creating. Do not create events without explicit user request.',
    inputSchema: {
      type: 'object',
      properties: {
        school_slug: { type: 'string', description: 'School slug (defaults to active school)' },
        name: { type: 'string', description: 'Event name shown to parents' },
        description: { type: 'string', description: 'Optional event description' },
        event_date: { type: 'string', description: 'Event date, YYYY-MM-DD' },
        starts_at: { type: 'string', description: 'Start time (e.g. 18:30)' },
        ends_at: { type: 'string', description: 'End time (e.g. 20:00)' },
        location: { type: 'string', description: 'Event location (e.g. Gymnasium)' },
        max_capacity: { type: 'integer', description: 'Maximum attendees/tickets; omit for unlimited' },
        ticket_price_cents: { type: 'integer', description: 'Ticket price in cents (0 = free)' },
      },
      required: ['name', 'event_date'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        eventDate: { type: 'string' },
        status: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Create Event (Admin)' },
  },
  {
    name: 'update_event',
    description:
      'ADMIN: Partially updates an existing school event — only the provided fields change; omitted fields keep their current values. Use for reschedules, capacity or price changes, and status transitions (cancelled/completed). Prefer cancel_event to cancel outright. Requires pac_cordinator or event_cordinator role. WRITE operation — confirm changes with the user. Get event_id from get_upcoming_events.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Event ID — from get_upcoming_events' },
        name: { type: 'string', description: 'New event name' },
        description: { type: 'string', description: 'New event description shown to parents' },
        event_date: { type: 'string', description: 'Event date, YYYY-MM-DD' },
        starts_at: { type: 'string', description: 'Start time (e.g. 18:30)' },
        ends_at: { type: 'string', description: 'End time (e.g. 20:00)' },
        location: { type: 'string', description: 'Event location (e.g. Gymnasium)' },
        max_capacity: { type: 'integer', description: 'Maximum number of attendees/tickets' },
        ticket_price_cents: { type: 'integer', description: 'Ticket price in cents; 0 for free events' },
        status: {
          type: 'string',
          enum: ['active', 'cancelled', 'completed'],
          description: 'Event status — cancelled stops sales, completed closes the event',
        },
      },
      required: ['event_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        eventDate: { type: 'string' },
        status: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Update Event (Admin)' },
  },
  {
    name: 'cancel_event',
    description:
      'ADMIN: Cancels a school event. Requires pac_cordinator or event_cordinator role. This is a DESTRUCTIVE operation - always confirm with the user before cancelling. Cancelled events cannot be reactivated.',
    inputSchema: {
      type: 'object',
      properties: { event_id: { type: 'string' } },
      required: ['event_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, title: 'Cancel Event (Admin)' },
  },
  {
    name: 'register_event',
    description:
      'Registers the authenticated user for a school event. Requires event_id. Optionally specify quantity (default 1). This is a WRITE operation - confirm with the user before registering. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Event ID' },
        quantity: { type: 'integer', description: 'Number of tickets', minimum: 1, default: 1 },
      },
      required: ['event_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        eventId: { type: 'string' },
        quantity: { type: 'integer' },
        status: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Register for Event' },
  },
  {
    name: 'sign_up_to_volunteer',
    description:
      'Signs up the authenticated user as a volunteer for a specific shift. Requires shift_id (from get_upcoming_events or event detail). This is a WRITE operation - confirm with the user before signing up. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        shift_id: { type: 'string', description: 'Volunteer shift ID' },
      },
      required: ['shift_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        shiftId: { type: 'string' },
        status: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Sign Up to Volunteer' },
  },

  // --- Admin: restaurants ---
  {
    name: 'list_school_restaurants',
    description:
      'ADMIN: Lists restaurants for the active school. Requires pac_cordinator, pac_member, or lunch_cordinator role. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { school_slug: { type: 'string', description: 'School slug (defaults to active school)' } },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        restaurants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: ['string', 'null'] },
              isActive: { type: 'boolean' },
              logoUrl: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: 'List School Restaurants (Admin)',
    },
  },
  {
    name: 'create_restaurant',
    description:
      'ADMIN: Creates a restaurant for the active school; the restaurant can then hold menu items via create_menu_item. Requires pac_cordinator role. WRITE operation — confirm with the user.',
    inputSchema: {
      type: 'object',
      properties: {
        school_slug: { type: 'string', description: 'School slug — defaults to the active school' },
        name: { type: 'string', description: 'Restaurant display name' },
        description: { type: 'string', description: 'Optional restaurant description' },
        tax_percent: { type: 'number', description: 'Sales tax percentage applied to orders (e.g. 5 for 5%)' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        isActive: { type: 'boolean' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      title: 'Create Restaurant (Admin)',
    },
  },

  // --- Admin: menu ---
  {
    name: 'list_menu_items',
    description:
      'ADMIN: Lists all menu items for a restaurant, including inactive and unavailable ones. Requires pac_cordinator or lunch_cordinator role. Read-only. Get restaurant_id from list_school_restaurants.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID — from list_school_restaurants' },
      },
      required: ['restaurant_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: ['string', 'null'] },
              priceCents: { type: 'integer' },
              costCents: { type: ['integer', 'null'] },
              isActive: { type: 'boolean' },
              isAvailable: { type: 'boolean' },
              calories: { type: ['integer', 'null'] },
              ingredients: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'List Menu Items (Admin)' },
  },
  {
    name: 'create_menu_item',
    description:
      'ADMIN: Creates a new menu item on a restaurant. Only restaurant_id and name are required — set price_cents before the item can be meaningfully ordered. New items start active and available; use update_menu_item to change them later. Requires pac_cordinator or lunch_cordinator role. WRITE operation — confirm with the user. Get restaurant_id from list_school_restaurants.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID — from list_school_restaurants' },
        name: { type: 'string', description: 'Item display name shown to parents' },
        description: { type: 'string', description: 'Optional item description' },
        cost_cents: { type: 'integer', description: 'Kitchen cost in cents (internal margin tracking)' },
        price_cents: { type: 'integer', description: 'Sale price in cents (e.g. 550 = $5.50)' },
        ingredients: { type: 'string', description: 'Ingredient list text' },
        calories: { type: 'integer', description: 'Calorie count' },
      },
      required: ['restaurant_id', 'name'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        priceCents: { type: 'integer' },
        isActive: { type: 'boolean' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      title: 'Create Menu Item (Admin)',
    },
  },
  {
    name: 'update_menu_item',
    description:
      'ADMIN: Partially updates an existing menu item — only the provided fields change; omitted fields keep their current values. Use for renames, description edits, price/cost changes, nutrition updates, or toggling availability (is_available for out-of-stock, is_active to retire an item). Prefer set_menu_item_price for a price-only change and delete_menu_item to remove the item permanently. Requires pac_cordinator or lunch_cordinator role. WRITE operation — confirm changes with the user. Get restaurant_id from list_school_restaurants and menu_item_id from list_menu_items.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID — from list_school_restaurants' },
        menu_item_id: { type: 'string', description: 'Menu item ID — from list_menu_items' },
        name: { type: 'string', description: 'New display name for the item' },
        description: { type: 'string', description: 'New item description shown to parents' },
        cost_cents: { type: 'integer', description: 'Kitchen cost in cents (internal margin tracking)' },
        ingredients: { type: 'string', description: 'Ingredient list text' },
        calories: { type: 'integer', description: 'Calorie count' },
        is_active: {
          type: 'boolean',
          description: 'Whether the item stays on the restaurant menu — set false to retire it',
        },
        price_cents: { type: 'integer', description: 'Sale price in cents (e.g. 550 = $5.50)' },
        is_available: {
          type: 'boolean',
          description: 'Whether the item can be ordered — set false while out of stock',
        },
      },
      required: ['restaurant_id', 'menu_item_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        priceCents: { type: 'integer' },
        isActive: { type: 'boolean' },
        isAvailable: { type: 'boolean' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      title: 'Update Menu Item (Admin)',
    },
  },
  {
    name: 'set_menu_item_price',
    description:
      'ADMIN: Sets the price of a menu item. Requires pac_cordinator or lunch_cordinator role. FINANCIAL + WRITE operation - confirm the new price with the user.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string' },
        menu_item_id: { type: 'string' },
        price_cents: { type: 'integer', description: 'New price in cents' },
      },
      required: ['restaurant_id', 'menu_item_id', 'price_cents'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        priceCents: { type: 'integer' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      title: 'Set Menu Item Price (Admin)',
    },
  },
  {
    name: 'delete_menu_item',
    description:
      'ADMIN: Soft-deletes a menu item. Requires pac_cordinator or lunch_cordinator role. DESTRUCTIVE operation - confirm with the user.',
    inputSchema: {
      type: 'object',
      properties: { restaurant_id: { type: 'string' }, menu_item_id: { type: 'string' } },
      required: ['restaurant_id', 'menu_item_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        deleted: { type: 'boolean' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
      title: 'Delete Menu Item (Admin)',
    },
  },
  {
    name: 'set_daily_menu',
    description:
      'ADMIN: Assigns a restaurant menu item to a date so parents can order it, optionally capping the quantity. Requires pac_cordinator or lunch_cordinator role. WRITE operation — confirm with the user. Get IDs from list_school_restaurants and list_menu_items.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID — from list_school_restaurants' },
        menu_item_id: { type: 'string', description: 'Menu item ID — from list_menu_items' },
        menu_date: { type: 'string', description: 'Date the item is orderable, YYYY-MM-DD' },
        available_qty: { type: 'integer', description: 'Maximum portions for the day; omit for unlimited' },
      },
      required: ['restaurant_id', 'menu_item_id', 'menu_date'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        menuItemId: { type: 'string' },
        menuDate: { type: 'string' },
        availableQty: { type: ['integer', 'null'] },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Set Daily Menu (Admin)' },
  },
];

// --- Resources (read-only data sources) ---
export const ALL_RESOURCES: ResourceDefinition[] = [
  {
    uri: 'paxaver://user/context',
    name: 'User Context',
    description: 'The authenticated user context: name, active school, students, and roles.',
    mimeType: 'application/json',
  },
  {
    uri: 'paxaver://menu/today',
    name: 'Today Lunch Menu',
    description: 'Today lunch menu for the user school, including available items and quantities.',
    mimeType: 'application/json',
  },
  {
    uri: 'paxaver://wallet/balance',
    name: 'Wallet Balance',
    description: 'Current wallet balance for the authenticated user.',
    mimeType: 'application/json',
  },
  {
    uri: 'paxaver://events/upcoming',
    name: 'Upcoming Events',
    description: 'Upcoming events at the user school.',
    mimeType: 'application/json',
  },
];

// --- Prompts (predefined templates) ---
export const ALL_PROMPTS: PromptDefinition[] = [
  {
    name: 'daily_lunch_menu',
    description: 'Show today lunch menu for the school.',
  },
  {
    name: 'wallet_balance',
    description: 'Check the current wallet balance.',
  },
  {
    name: 'upcoming_events',
    description: 'List upcoming events at the school.',
  },
  {
    name: 'order_lunch_helper',
    description: 'Guide the user through ordering lunch for a student.',
    arguments: [
      {
        name: 'student_name',
        description: 'The student name to order lunch for.',
        required: false,
      },
    ],
  },
];
