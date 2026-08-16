import type { ToolDefinition } from './index.js';

export const eventTools: ToolDefinition[] = [
  {
    name: 'get_upcoming_events',
    description:
      'Returns upcoming events for the user\'s active school. Optionally filter by date range (start_date / end_date, YYYY-MM-DD). Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get Upcoming Events' },
  },
  {
    name: 'create_event',
    description:
      'ADMIN: Creates a school event. Requires school_master or event_cordinator role. This is a WRITE operation — confirm details with the user before creating. Do not create events without explicit user request.',
    inputSchema: {
      type: 'object',
      properties: {
        school_slug: { type: 'string', description: 'School slug (defaults to active school)' },
        name: { type: 'string' },
        description: { type: 'string' },
        event_date: { type: 'string', description: 'YYYY-MM-DD' },
        starts_at: { type: 'string' },
        ends_at: { type: 'string' },
        location: { type: 'string' },
        max_capacity: { type: 'integer' },
        ticket_price_cents: { type: 'integer', description: 'Ticket price in cents (0 = free)' },
      },
      required: ['name', 'event_date'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Create Event (Admin)' },
  },
  {
    name: 'update_event',
    description:
      'ADMIN: Updates an existing school event. Requires school_master or event_cordinator role. WRITE operation — confirm changes with the user.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        event_date: { type: 'string', description: 'YYYY-MM-DD' },
        starts_at: { type: 'string' },
        ends_at: { type: 'string' },
        location: { type: 'string' },
        max_capacity: { type: 'integer' },
        ticket_price_cents: { type: 'integer' },
        status: { type: 'string', enum: ['active', 'cancelled', 'completed'] },
      },
      required: ['event_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Update Event (Admin)' },
  },
  {
    name: 'cancel_event',
    description:
      'ADMIN: Cancels a school event. Requires school_master or event_cordinator role. This is a DESTRUCTIVE operation — always confirm with the user before cancelling. Cancelled events cannot be reactivated.',
    inputSchema: {
      type: 'object',
      properties: { event_id: { type: 'string' } },
      required: ['event_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, title: 'Cancel Event (Admin)' },
  },
  {
    name: 'register-event',
    description:
      'Registers the authenticated user for a school event. Requires event_id. Optionally specify quantity (default 1) and attendee details. This is a WRITE operation — confirm with the user before registering. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Event ID' },
        quantity: { type: 'integer', description: 'Number of tickets', minimum: 1, default: 1 },
        email: { type: 'string', description: 'Email for confirmation' },
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
      },
      required: ['event_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Register for Event' },
  },
  {
    name: 'request-volunteer',
    description:
      'Signs up the authenticated user as a volunteer for a specific shift. Requires shift_id (from get_upcoming_events or event detail). This is a WRITE operation — confirm with the user before signing up. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        shift_id: { type: 'string', description: 'Volunteer shift ID' },
        notes: { type: 'string', description: 'Optional notes' },
      },
      required: ['shift_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Request Volunteer' },
  },
];
