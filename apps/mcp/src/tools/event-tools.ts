/**
 * Event tool handlers.
 */

import { callPaxaverApi } from '../api/client.js';
import type { ApiCallResult } from '../api/client.js';
import type { ToolHandlerArgs } from './shared.js';
import { validatePathId } from './shared.js';

export async function handleEventTools({
  env,
  ctx,
  origin,
  name,
  args,
  idempotencyKey,
}: ToolHandlerArgs): Promise<ApiCallResult | undefined> {
  switch (name) {
    case 'get_upcoming_events':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/events',
        query: {
          start_date: args.start_date as string | undefined,
          end_date: args.end_date as string | undefined,
        },
      });
    case 'create_event':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/events',
        body: args,
        idempotencyKey,
      });
    case 'update_event':
      return callPaxaverApi(env, ctx, origin, {
        method: 'PATCH',
        path: `/api/events/${validatePathId(args.event_id, 'event_id')}`,
        body: args,
        idempotencyKey,
      });
    case 'cancel_event':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/events/${validatePathId(args.event_id, 'event_id')}/cancel`,
        idempotencyKey,
      });
    case 'register_event':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/events/${validatePathId(args.event_id, 'event_id')}/tickets`,
        body: args,
        idempotencyKey,
      });
    case 'request_volunteer':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/volunteers/signups',
        body: args,
        idempotencyKey,
      });
    default:
      return undefined;
  }
}
