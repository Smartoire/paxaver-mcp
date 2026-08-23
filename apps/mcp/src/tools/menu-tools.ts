/**
 * Admin menu tool handlers.
 */

import { callPaxaverApi } from '../api/client.js';
import type { ApiCallResult } from '../api/client.js';
import type { ToolHandlerArgs } from './shared.js';
import { validatePathId } from './shared.js';

export async function handleMenuTools({
  env,
  ctx,
  origin,
  name,
  args,
  idempotencyKey,
}: ToolHandlerArgs): Promise<ApiCallResult | undefined> {
  switch (name) {
    case 'list_menu_items':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items`,
      });
    case 'create_menu_item':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items`,
        body: args,
        idempotencyKey,
      });
    case 'update_menu_item':
    case 'set_menu_item_price':
      return callPaxaverApi(env, ctx, origin, {
        method: 'PATCH',
        path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items/${validatePathId(args.menu_item_id, 'menu_item_id')}`,
        body: args,
        idempotencyKey,
      });
    case 'delete_menu_item':
      return callPaxaverApi(env, ctx, origin, {
        method: 'DELETE',
        path: `/api/lunch/restaurants/${validatePathId(args.restaurant_id, 'restaurant_id')}/items/${validatePathId(args.menu_item_id, 'menu_item_id')}`,
        idempotencyKey,
      });
    case 'set_daily_menu':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: `/api/lunch/schools/${validatePathId(ctx.schoolSlug, 'schoolSlug')}/menu/daily`,
        body: args,
        idempotencyKey,
      });
    default:
      return undefined;
  }
}
