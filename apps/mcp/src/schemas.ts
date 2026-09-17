/**
 * Tool, resource, and prompt schema registry. Each tool has name,
 * description, inputSchema, outputSchema, and annotations. The
 * authorization policy lives in lib/policies.ts.
 */

export interface ToolDefinition {
  name: string;
  /** Human-readable display title. */
  title?: string;
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
    title: 'Get User Info',
    description:
      "Returns the authenticated user's context: first name, active school, the students they are a guardian for, and their roles. Call this when you need a student_id, school_slug, or to check whether the user holds an admin role - most other tools take those IDs as input.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        firstName: {
          type: ['string', 'null'],
          description: 'User first name',
        },
        schoolSlug: {
          type: ['string', 'null'],
          description: 'Active school slug',
        },
        schoolName: {
          type: ['string', 'null'],
          description: 'Active school display name',
        },
        students: {
          type: 'array',
          items: {
            type: 'object',
          },
          description: 'Students the user is guardian for (id, firstName, schoolSlug)',
        },
        roles: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Role codes the user holds at the active school',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get User Info' },
  },
  // --- Wallet ---
  {
    name: 'get_wallet_balance',
    title: 'Get Wallet Balance',
    description:
      'Returns the spendable wallet balance for the authenticated user at their active school, in cents and formatted. Call before order_lunch, finalize_order, or register_event to confirm the user can cover the charge; not needed for read-only lookups.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        balanceCents: {
          type: ['number', 'null'],
          description: 'Spendable balance in cents',
        },
        balanceFormatted: {
          type: ['string', 'null'],
          description: 'Balance formatted with the currency symbol',
        },
        currency: {
          type: ['string', 'null'],
          description: 'ISO currency code (CAD, USD, or MXN)',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Wallet Balance' },
  },
  // --- Orders ---
  {
    name: 'order_lunch',
    title: 'Order Lunch',
    description:
      "Places and pays for a single-item lunch order for one student - the wallet is charged immediately. For a multi-item order or an order the user should review before paying, use create_draft_order then finalize_order instead. Requires menu_item_id from get_menu and menu_date; student_id is required when the user has more than one student and defaults to the user's only student otherwise (IDs from get_user_info). FINANCIAL - confirm student, item, date, and quantity before calling.",
    inputSchema: {
      type: 'object',
      properties: {
        student_id: { type: 'string', description: 'Student ID (must be your own student; from get_user_info)' },
        menu_item_id: { type: 'string', description: 'Menu item ID from get_menu' },
        menu_date: { type: 'string', description: 'Date the lunch is served, YYYY-MM-DD' },
        quantity: { type: 'integer', description: 'Number of servings (default 1)', minimum: 1, default: 1 },
      },
      required: ['menu_item_id', 'menu_date'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Order ID',
        },
        studentId: {
          type: 'string',
          description: 'Student the order is for',
        },
        schoolSlug: {
          type: 'string',
          description: 'School the order was placed at',
        },
        menuDate: {
          type: 'string',
          description: 'Date the lunch is served, YYYY-MM-DD',
        },
        status: {
          type: 'string',
          description: 'Order status (e.g. finalized)',
        },
        itemTotalCents: {
          type: 'integer',
          description: 'Item total in cents',
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
          },
          description: 'Ordered line items',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Order Lunch',
    },
  },
  {
    name: 'get_orders',
    title: 'Get Orders',
    description:
      "Returns lunch orders already placed - items, menu date, status, and total - for the authenticated user's students. Filter by student_id, a single menu_date, or a month; with no filters returns recent orders. Admins (pac_cordinator, lunch_cordinator) see school-wide orders; parents only their own students. For what can be ordered (menu and prices), use get_menu.",
    inputSchema: {
      type: 'object',
      properties: {
        student_id: {
          type: 'string',
          description: 'Filter to a specific student (must be your own; from get_user_info)',
        },
        menu_date: { type: 'string', description: 'Single day to query, YYYY-MM-DD' },
        month: { type: 'string', description: 'Calendar month to query, YYYY-MM' },
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
              id: {
                type: 'string',
                description: 'Order ID',
              },
              studentId: {
                type: 'string',
                description: 'Student the order is for',
              },
              menuDate: {
                type: 'string',
                description: 'Date the lunch is served, YYYY-MM-DD',
              },
              status: {
                type: 'string',
                description: 'Order status',
              },
              itemTotalCents: {
                type: 'integer',
                description: 'Item total in cents',
              },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                },
                description: 'Ordered line items',
              },
              createdAt: {
                type: 'string',
                description: 'ISO timestamp the order was placed',
              },
            },
          },
          description: 'Orders matching the filters',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Orders' },
  },
  {
    name: 'get_menu',
    title: 'Get Menu',
    description:
      "Returns the orderable lunch menu for the user's active school - item names, prices, dietary tags, and remaining quantity - for one date or a full month (today if neither is given). The menu_item_id values returned are required by order_lunch and create_draft_order. For orders already placed, use get_orders.",
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Single day to show, YYYY-MM-DD' },
        month: { type: 'string', description: 'Calendar month to show, YYYY-MM' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date this menu applies to, YYYY-MM-DD',
        },
        menuItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dailyMenuId: {
                type: 'string',
                description: 'Daily-menu entry ID',
              },
              menuItemId: {
                type: 'string',
                description: 'Menu item ID for ordering tools',
              },
              menuItemName: {
                type: 'string',
                description: 'Item display name',
              },
              restaurantName: {
                type: ['string', 'null'],
                description: 'Restaurant offering the item',
              },
              priceCents: {
                type: 'integer',
                description: 'Sale price in cents',
              },
              availableQty: {
                type: ['integer', 'null'],
                description: 'Remaining portions; null means unlimited',
              },
              dietaryTags: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Dietary labels (e.g. vegetarian, halal)',
              },
            },
          },
          description: 'Items orderable on that date',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Menu' },
  },
  {
    name: 'create_draft_order',
    title: 'Create Draft Order',
    description:
      'Creates an unpaid draft lunch order with one or more items - nothing is charged until finalize_order commits it. Use for multi-item orders or when the user should review the total first; for a single item paid immediately, order_lunch is simpler. FINANCIAL - confirm student, items, and date before calling.',
    inputSchema: {
      type: 'object',
      properties: {
        student_id: { type: 'string', description: 'Student ID (must be your own student; from get_user_info)' },
        school_slug: { type: 'string', description: 'School slug (from get_user_info)' },
        menu_date: { type: 'string', description: 'Date the lunch is served, YYYY-MM-DD' },
        items: {
          type: 'array',
          description: 'Line items to order; get IDs and prices from get_menu',
          items: {
            type: 'object',
            properties: {
              menu_item_id: { type: 'string', description: 'Menu item ID from get_menu' },
              menu_item_name: { type: 'string', description: 'Item display name from get_menu' },
              price_cents: { type: 'integer', description: 'Unit price in cents from get_menu' },
              quantity: { type: 'integer', description: 'Number of servings', minimum: 1 },
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
        id: {
          type: 'string',
          description: 'Draft order ID - pass to finalize_order',
        },
        studentId: {
          type: 'string',
          description: 'Student the order is for',
        },
        schoolSlug: {
          type: 'string',
          description: 'School the order was placed at',
        },
        menuDate: {
          type: 'string',
          description: 'Date the lunch is served, YYYY-MM-DD',
        },
        status: {
          type: 'string',
          description: 'Order status (draft)',
        },
        itemTotalCents: {
          type: 'integer',
          description: 'Item total in cents - charged on finalize',
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
          },
          description: 'Draft line items',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Create Draft Order',
    },
  },
  {
    name: 'finalize_order',
    title: 'Finalize Order',
    description:
      "Commits a draft order from create_draft_order and charges the wallet for the item total plus optional tip_cents (donated to the school's PAC). Not for new orders - use order_lunch or create_draft_order first. FINANCIAL - confirm the total before calling.",
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
        id: {
          type: 'string',
          description: 'Order ID',
        },
        status: {
          type: 'string',
          description: 'Order status (finalized)',
        },
        itemTotalCents: {
          type: 'integer',
          description: 'Item total in cents',
        },
        tipCents: {
          type: 'integer',
          description: 'PAC donation added, in cents',
        },
        totalCents: {
          type: 'integer',
          description: 'Total charged to the wallet, in cents',
        },
        balanceCents: {
          type: ['number', 'null'],
          description: 'Wallet balance after the charge, in cents',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Finalize Order',
    },
  },
  {
    name: 'cancel_order',
    title: 'Cancel Order',
    description:
      'Cancels a finalized order and refunds the charge to the wallet. Only works before order labels have been sent; after that the request is rejected and the order stands. DESTRUCTIVE - confirm with the user before cancelling.',
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
        id: {
          type: 'string',
          description: 'Order ID',
        },
        status: {
          type: 'string',
          description: 'Order status (cancelled)',
        },
        refundCents: {
          type: 'integer',
          description: 'Amount refunded to the wallet, in cents',
        },
        balanceCents: {
          type: ['number', 'null'],
          description: 'Wallet balance after the refund, in cents',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Cancel Order',
    },
  },

  // --- Events ---
  {
    name: 'get_upcoming_events',
    title: 'Get Upcoming Events',
    description:
      "Returns upcoming events for the user's active school: date, times, location, and whether registration is closed. The event IDs returned feed register_event, update_event, and cancel_event. Optionally filter by date range.",
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
              id: {
                type: 'string',
                description: 'Event ID - input to register_event, update_event, cancel_event',
              },
              name: {
                type: 'string',
                description: 'Event name',
              },
              eventDate: {
                type: 'string',
                description: 'Event date, YYYY-MM-DD',
              },
              startsAt: {
                type: ['string', 'null'],
                description: 'Start time',
              },
              endsAt: {
                type: ['string', 'null'],
                description: 'End time',
              },
              location: {
                type: ['string', 'null'],
                description: 'Event location',
              },
              isClosed: {
                type: 'boolean',
                description: 'Whether registration is closed',
              },
            },
          },
          description: 'Upcoming events matching the date range',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Upcoming Events' },
  },
  {
    name: 'create_event',
    title: 'Create Event (Admin)',
    description:
      'ADMIN: Creates a school event, optionally ticketed, at the active school. To change an existing event use update_event; to register a parent for an event use register_event. Requires pac_cordinator or event_cordinator role. WRITE - only create on explicit user request.',
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
        id: {
          type: 'string',
          description: 'Event ID',
        },
        name: {
          type: 'string',
          description: 'Event name',
        },
        eventDate: {
          type: 'string',
          description: 'Event date, YYYY-MM-DD',
        },
        status: {
          type: 'string',
          description: 'Event status (e.g. active)',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Create Event (Admin)',
    },
  },
  {
    name: 'update_event',
    title: 'Update Event (Admin)',
    description:
      'ADMIN: Partially updates an existing school event - only the provided fields change; omitted fields keep their current values. Use for reschedules, capacity or price changes, and status transitions (cancelled/completed). Prefer cancel_event to cancel outright. Requires pac_cordinator or event_cordinator role. WRITE operation - confirm changes with the user. Get event_id from get_upcoming_events.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Event ID - from get_upcoming_events' },
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
          description: 'Event status - cancelled stops sales, completed closes the event',
        },
      },
      required: ['event_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Event ID',
        },
        name: {
          type: 'string',
          description: 'Event name',
        },
        eventDate: {
          type: 'string',
          description: 'Event date, YYYY-MM-DD',
        },
        status: {
          type: 'string',
          description: 'Event status after the update',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Update Event (Admin)',
    },
  },
  {
    name: 'cancel_event',
    title: 'Cancel Event (Admin)',
    description:
      'ADMIN: Cancels a school event outright; cancelled events cannot be reactivated. For schedule, capacity, or price changes use update_event instead. Requires pac_cordinator or event_cordinator role. DESTRUCTIVE - confirm with the user. Get event_id from get_upcoming_events.',
    inputSchema: {
      type: 'object',
      properties: { event_id: { type: 'string', description: 'Event ID - from get_upcoming_events' } },
      required: ['event_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Event ID',
        },
        status: {
          type: 'string',
          description: 'Event status (cancelled)',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Cancel Event (Admin)',
    },
  },
  {
    name: 'register_event',
    title: 'Register for Event',
    description:
      "Registers the authenticated user for a school event and issues tickets. For paid events the total is charged to the user's wallet - the call fails on insufficient balance. quantity defaults to 1. To volunteer at an event rather than attend, use sign_up_to_volunteer. FINANCIAL for paid events - confirm before registering.",
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
        id: {
          type: 'string',
          description: 'Registration ID',
        },
        eventId: {
          type: 'string',
          description: 'Event the user registered for',
        },
        quantity: {
          type: 'integer',
          description: 'Tickets issued',
        },
        status: {
          type: 'string',
          description: 'Registration status',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Register for Event',
    },
  },
  {
    name: 'sign_up_to_volunteer',
    title: 'Sign Up to Volunteer',
    description:
      "Signs the authenticated user up for a specific volunteer shift - no payment involved. To attend an event as a guest instead, use register_event. Requires shift_id (from the event's volunteer shifts). WRITE - confirm with the user before signing up.",
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
        id: {
          type: 'string',
          description: 'Signup ID',
        },
        shiftId: {
          type: 'string',
          description: 'Volunteer shift signed up for',
        },
        status: {
          type: 'string',
          description: 'Signup status',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Sign Up to Volunteer',
    },
  },

  // --- Admin: restaurants ---
  {
    name: 'list_school_restaurants',
    title: 'List School Restaurants (Admin)',
    description:
      'ADMIN: Lists the active restaurants attached to a school (defaults to the active school). Inactive restaurants are not returned. The restaurant_id values returned are required by list_menu_items, create_menu_item, update_menu_item, delete_menu_item, and set_daily_menu. Requires pac_cordinator, pac_member, or lunch_cordinator role.',
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
              id: {
                type: 'string',
                description: 'Restaurant ID - input to menu-item and daily-menu tools',
              },
              name: {
                type: 'string',
                description: 'Restaurant name',
              },
              description: {
                type: ['string', 'null'],
                description: 'Restaurant description',
              },
              isActive: {
                type: 'boolean',
                description: 'Whether the restaurant is active',
              },
              logoUrl: {
                type: ['string', 'null'],
                description: 'Restaurant logo URL',
              },
            },
          },
          description: 'Active restaurants attached to the school (inactive ones are excluded)',
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
    title: 'Create Restaurant (Admin)',
    description:
      'ADMIN: Adds a restaurant to the active school so it can offer menu items via create_menu_item. To change an existing restaurant there is no update tool - recreate or manage it in the Paxaver admin. Requires pac_cordinator role. WRITE - confirm with the user.',
    inputSchema: {
      type: 'object',
      properties: {
        school_slug: { type: 'string', description: 'School slug - defaults to the active school' },
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
        id: {
          type: 'string',
          description: 'Restaurant ID',
        },
        name: {
          type: 'string',
          description: 'Restaurant name',
        },
        isActive: {
          type: 'boolean',
          description: 'Whether the restaurant is active',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Create Restaurant (Admin)',
    },
  },

  // --- Admin: menu ---
  {
    name: 'list_menu_items',
    title: 'List Menu Items (Admin)',
    description:
      'ADMIN: Lists the full menu-item catalog for a restaurant, including inactive and unavailable items - this is the catalog, not what parents can order on a date (use get_menu for that). Provides menu_item_id values for update_menu_item, delete_menu_item, and set_daily_menu. Requires pac_cordinator or lunch_cordinator role. Get restaurant_id from list_school_restaurants.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID - from list_school_restaurants' },
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
              id: {
                type: 'string',
                description: 'Menu item ID',
              },
              name: {
                type: 'string',
                description: 'Item name',
              },
              description: {
                type: ['string', 'null'],
                description: 'Item description',
              },
              priceCents: {
                type: 'integer',
                description: 'Sale price in cents',
              },
              costCents: {
                type: ['integer', 'null'],
                description: 'Kitchen cost in cents',
              },
              isActive: {
                type: 'boolean',
                description: 'Whether the item is on the restaurant menu',
              },
              isAvailable: {
                type: 'boolean',
                description: 'Whether the item can currently be ordered',
              },
              calories: {
                type: ['integer', 'null'],
                description: 'Calorie count',
              },
              ingredients: {
                type: ['string', 'null'],
                description: 'Ingredient list text',
              },
            },
          },
          description: 'Full catalog items, including inactive and unavailable',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'List Menu Items (Admin)' },
  },
  {
    name: 'create_menu_item',
    title: 'Create Menu Item (Admin)',
    description:
      'ADMIN: Creates a new menu item on a restaurant. Only restaurant_id and name are required - set price_cents before the item can be meaningfully ordered. New items start active and available; use update_menu_item to change them later. Requires pac_cordinator or lunch_cordinator role. WRITE operation - confirm with the user. Get restaurant_id from list_school_restaurants.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID - from list_school_restaurants' },
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
        id: {
          type: 'string',
          description: 'Menu item ID',
        },
        name: {
          type: 'string',
          description: 'Item name',
        },
        priceCents: {
          type: 'integer',
          description: 'Sale price in cents',
        },
        isActive: {
          type: 'boolean',
          description: 'Whether the item is on the restaurant menu',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Create Menu Item (Admin)',
    },
  },
  {
    name: 'update_menu_item',
    title: 'Update Menu Item (Admin)',
    description:
      'ADMIN: Partially updates an existing menu item - only the provided fields change; omitted fields keep their current values. Use for renames, description edits, price changes (price_cents - FINANCIAL, confirm the new price), nutrition updates, or toggling availability (is_available for out-of-stock, is_active to retire an item). Use delete_menu_item to remove the item permanently. Requires pac_cordinator or lunch_cordinator role. WRITE operation - confirm changes with the user. Get restaurant_id from list_school_restaurants and menu_item_id from list_menu_items.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID - from list_school_restaurants' },
        menu_item_id: { type: 'string', description: 'Menu item ID - from list_menu_items' },
        name: { type: 'string', description: 'New display name for the item' },
        description: { type: 'string', description: 'New item description shown to parents' },
        cost_cents: { type: 'integer', description: 'Kitchen cost in cents (internal margin tracking)' },
        ingredients: { type: 'string', description: 'Ingredient list text' },
        calories: { type: 'integer', description: 'Calorie count' },
        is_active: {
          type: 'boolean',
          description: 'Whether the item stays on the restaurant menu - set false to retire it',
        },
        price_cents: { type: 'integer', description: 'Sale price in cents (e.g. 550 = $5.50)' },
        is_available: {
          type: 'boolean',
          description: 'Whether the item can be ordered - set false while out of stock',
        },
      },
      required: ['restaurant_id', 'menu_item_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Menu item ID',
        },
        name: {
          type: 'string',
          description: 'Item name',
        },
        priceCents: {
          type: 'integer',
          description: 'Sale price in cents',
        },
        isActive: {
          type: 'boolean',
          description: 'Whether the item is on the restaurant menu',
        },
        isAvailable: {
          type: 'boolean',
          description: 'Whether the item can currently be ordered',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Update Menu Item (Admin)',
    },
  },
  {
    name: 'delete_menu_item',
    title: 'Delete Menu Item (Admin)',
    description:
      'ADMIN: Soft-deletes a menu item so it can no longer be ordered. To only hide it temporarily, prefer update_menu_item with is_available=false. Requires pac_cordinator or lunch_cordinator role. DESTRUCTIVE operation - confirm with the user. Get restaurant_id from list_school_restaurants and menu_item_id from list_menu_items.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID - from list_school_restaurants' },
        menu_item_id: { type: 'string', description: 'Menu item ID - from list_menu_items' },
      },
      required: ['restaurant_id', 'menu_item_id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Menu item ID',
        },
        deleted: {
          type: 'boolean',
          description: 'Whether the item was soft-deleted',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Delete Menu Item (Admin)',
    },
  },
  {
    name: 'set_daily_menu',
    title: 'Set Daily Menu (Admin)',
    description:
      'ADMIN: Puts a restaurant menu item on the orderable menu for a given date, optionally capping portions. This only schedules the item - to retire it entirely use update_menu_item (is_active) or delete_menu_item. Requires pac_cordinator or lunch_cordinator role. WRITE - confirm with the user. Get IDs from list_school_restaurants and list_menu_items.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'Restaurant ID - from list_school_restaurants' },
        menu_item_id: { type: 'string', description: 'Menu item ID - from list_menu_items' },
        menu_date: { type: 'string', description: 'Date the item is orderable, YYYY-MM-DD' },
        available_qty: { type: 'integer', description: 'Maximum portions for the day; omit for unlimited' },
      },
      required: ['restaurant_id', 'menu_item_id', 'menu_date'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Daily-menu entry ID',
        },
        menuItemId: {
          type: 'string',
          description: 'Menu item scheduled',
        },
        menuDate: {
          type: 'string',
          description: 'Date the item is orderable, YYYY-MM-DD',
        },
        availableQty: {
          type: ['integer', 'null'],
          description: 'Portion cap for the day; null means unlimited',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      title: 'Set Daily Menu (Admin)',
    },
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
