/**
 * Wallet tool handlers.
 */

import { callPaxaverApi } from '../api/client.js';
import type { ApiCallResult } from '../api/client.js';
import type { ToolHandlerArgs } from './shared.js';

export async function handleWalletTools({
  env,
  ctx,
  origin,
  name,
  args,
  idempotencyKey,
}: ToolHandlerArgs): Promise<ApiCallResult | undefined> {
  switch (name) {
    case 'get_wallet_balance':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/wallet/balance',
      });
    case 'get_wallet_status':
      return callPaxaverApi(env, ctx, origin, {
        method: 'GET',
        path: '/api/wallet/transactions',
      });
    case 'add_funds':
    case 'top_up_balance':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/wallet/deposit',
        body: args,
        idempotencyKey,
      });
    case 'donate_to_school':
      return callPaxaverApi(env, ctx, origin, {
        method: 'POST',
        path: '/api/donations',
        body: args,
        idempotencyKey,
      });
    default:
      return undefined;
  }
}
