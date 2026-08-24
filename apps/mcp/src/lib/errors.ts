/**
 * MCP error helpers. Consistent error codes that don't leak backend details.
 */

export interface McpErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export function mcpError(id: string | number | null, code: number, message: string, data?: unknown): McpErrorResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/**
 * Map a backend API error status to a user-safe MCP error message.
 * Never expose D1/Stripe/internal error text to the AI client.
 */
export function apiErrorToMcp(status: number, _toolName: string): { code: number; message: string } {
  switch (status) {
    case 401:
      return { code: -32001, message: 'Authentication failed. Please reconnect your Paxaver account.' };
    case 403:
      return { code: -32002, message: 'You do not have permission to perform this action.' };
    case 404:
      return { code: -32001, message: 'The requested resource was not found or you do not have access to it.' };
    case 409:
      return { code: -32003, message: 'This action conflicts with existing data. It may have already been performed.' };
    case 429:
      return { code: -32004, message: 'Too many requests. Please wait and try again.' };
    case 422:
      return { code: -32602, message: 'The request was invalid. Check the parameters and try again.' };
    default:
      return { code: -32603, message: 'The request could not be completed. Please try again later.' };
  }
}
