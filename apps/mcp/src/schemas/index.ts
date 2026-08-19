/**
 * Tool schema registry. Each tool has name, description, inputSchema,
 * outputSchema, and annotations. The authorization policy lives in
 * lib/policy.ts.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
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

export { userTools } from './user-tools.js';
export { walletTools } from './wallet-tools.js';
export { orderTools } from './order-tools.js';
export { eventTools } from './event-tools.js';
export { restaurantTools } from './restaurant-tools.js';

import { userTools } from './user-tools.js';
import { walletTools } from './wallet-tools.js';
import { orderTools } from './order-tools.js';
import { eventTools } from './event-tools.js';
import { restaurantTools } from './restaurant-tools.js';

export const ALL_TOOLS: ToolDefinition[] = [
  ...userTools,
  ...walletTools,
  ...orderTools,
  ...eventTools,
  ...restaurantTools,
];
