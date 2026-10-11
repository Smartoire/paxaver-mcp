/**
 * Error helper tests: MCP error response shape and API error mapping.
 */

import { describe, it, expect } from 'vitest';
import { mcpError, apiErrorToMcp } from '../src/lib/errors.js';

describe('mcpError', () => {
  it('produces a valid JSON-RPC error response', () => {
    const res = mcpError(1, -32601, 'Method not found');
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.error.code).toBe(-32601);
    expect(res.error.message).toBe('Method not found');
    expect(res.error.data).toBeUndefined();
  });

  it('includes data when provided', () => {
    const res = mcpError('abc', -32602, 'Bad params', { field: 'date' });
    expect(res.error.data).toEqual({ field: 'date' });
  });

  it('omits data when undefined', () => {
    const res = mcpError(null, -32603, 'Internal error', undefined);
    expect(res.error.data).toBeUndefined();
  });

  it('accepts null id', () => {
    const res = mcpError(null, -32700, 'Parse error');
    expect(res.id).toBeNull();
  });
});

describe('apiErrorToMcp', () => {
  it('maps 401 to authentication error', () => {
    const { code, message } = apiErrorToMcp(401);
    expect(code).toBe(-32001);
    expect(message).toContain('Authentication failed');
  });

  it('maps 403 to permission error', () => {
    const { code, message } = apiErrorToMcp(403);
    expect(code).toBe(-32002);
    expect(message).toContain('permission');
  });

  it('maps 404 to not-found error', () => {
    const { code } = apiErrorToMcp(404);
    expect(code).toBe(-32001);
  });

  it('maps 409 to conflict error', () => {
    const { code, message } = apiErrorToMcp(409);
    expect(code).toBe(-32003);
    expect(message).toContain('conflict');
  });

  it('maps 429 to rate-limit error', () => {
    const { code, message } = apiErrorToMcp(429);
    expect(code).toBe(-32004);
    expect(message).toContain('Too many requests');
  });

  it('maps 422 to invalid-params error', () => {
    const { code } = apiErrorToMcp(422);
    expect(code).toBe(-32602);
  });

  it('maps unknown status to internal error', () => {
    const { code, message } = apiErrorToMcp(500);
    expect(code).toBe(-32603);
    expect(message).not.toContain('D1');
    expect(message).not.toContain('Stripe');
  });

  it('never leaks backend details', () => {
    for (const status of [401, 403, 404, 409, 429, 422, 500, 502, 503]) {
      const { message } = apiErrorToMcp(status);
      expect(message).not.toMatch(/D1|SQLite|Stripe|internal|stack|trace|query/i);
    }
  });
});
