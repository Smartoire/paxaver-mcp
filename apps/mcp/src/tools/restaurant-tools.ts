/**
 * Admin restaurant tool handlers.
 */

import { callPaxaverApi } from '../api/client.js';
import type { ApiCallResult } from '../api/client.js';
import type { ToolHandlerArgs } from './shared.js';
import { validatePathId } from './shared.js';

export async function handleRestaurantTools({
  env,
  ctx,
  origin,
  name,
  args,
  idempotencyKey,
}: ToolHandlerArgs): Promise<ApiCallResult | undefined> {
  switch (name) {
    case 'list_school_restaurants':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: `/api/schools/${validatePathId(args.school_slug || ctx.schoolSlug, 'school_slug')}/restaurants`,
      });
    case 'create_restaurant':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/restaurants`,
        body: args,
        idempotencyKey,
      });
    default:
      return undefined;
  }
}
