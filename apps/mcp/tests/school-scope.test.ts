/**
 * School-scoped role checks (#4128). A role-gated tool is authorized for the
 * school it acts on (school_slug, else the active school), not for the
 * active school alone. The backend stub resolves /me/context per school,
 * as the real backend does with ?schoolSlug.
 */

import { describe, it, expect } from 'vitest';
import { decodeJwt } from 'jose';
import app from '../src/index.js';
import { request } from './request.js';
import { makeToken, mockBackend, TEST_ENV } from './jwt-auth.js';

// user -> school -> permissions at that school
const ROLES: Record<string, Record<string, string[]>> = {
  // Coordinator at school-b only; her active school (school-a) has no role.
  'user-coord': { 'school-a': [], 'school-b': ['pac_cordinator'] },
  // Coordinator with no active school at all.
  'user-coord-null': { 'school-b': ['pac_cordinator'] },
  // Parent at school-b: a member with no coordinator role.
  'user-parent': { 'school-b': [] },
};
const ACTIVE: Record<string, string> = {
  'user-coord': 'school-a',
  'user-coord-null': '',
  'user-parent': 'school-b',
};

const backendRequests: { method: string; path: string; schoolSlug: string | null; body?: unknown }[] = [];

function contextFor(sub: string, schoolQuery: string | null) {
  const active = ACTIVE[sub] ?? '';
  const school = schoolQuery || active;
  return {
    userId: sub,
    email: 'test@paxaver.dev',
    schoolSlug: school,
    permissions: ROLES[sub]?.[school] ?? [],
    isPlatformAdmin: false,
    studentIds: [],
    country: 'ca',
    subscription: { status: 'active', toolLevel: 'full', expiry: '2099-07-31T00:00:00Z' },
  };
}

const schoolBackend = {
  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const req = typeof input === 'string' ? new Request(input, init) : input;
    const url = new URL(req.url);
    const schoolSlug = url.searchParams.get('schoolSlug');
    if (url.pathname === '/api/users/me/context') {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
      const sub = decodeJwt(token).sub ?? '';
      if (!ROLES[sub]) return mockBackend.fetch(req);
      return Response.json({ data: contextFor(sub, schoolSlug) });
    }
    const body =
      req.method === 'POST' || req.method === 'PATCH'
        ? await req
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    backendRequests.push({ method: req.method, path: url.pathname, schoolSlug, body });
    return Response.json({ data: { ok: true } });
  },
};

const ENV = { ...TEST_ENV, PAXAVER_API_CA: schoolBackend };

async function callCreateEvent(sub: string, args: Record<string, unknown>) {
  return callTool(sub, 'create_school_event', { name: 'Bake sale', event_date: '2026-12-10', ...args });
}

async function callTool(sub: string, name: string, args: Record<string, unknown>) {
  backendRequests.length = 0;
  const token = await makeToken(sub);
  const res = await request(
    app,
    'https://mcp.paxaver.test/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    },
    ENV,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
}

describe('role-gated tools check the target school (#4128)', () => {
  it('coordinator acting on her own school (not the active one) is allowed', async () => {
    const json = await callCreateEvent('user-coord', { school_slug: 'school-b' });
    expect(json.error).toBeUndefined();
    expect(json.result).toBeDefined();
  });

  it('the backend write is sent for that school, with the school in the query and body', async () => {
    await callCreateEvent('user-coord', { school_slug: 'school-b' });
    const create = backendRequests.find((r) => r.method === 'POST' && r.path === '/api/events');
    expect(create?.schoolSlug).toBe('school-b');
    expect((create?.body as { schoolSlug?: string })?.schoolSlug).toBe('school-b');
  });

  it('without school_slug, the active school decides: no role there, so refused', async () => {
    const json = await callCreateEvent('user-coord', {});
    expect(json.error?.code).toBe(-32603);
    expect(json.error?.message).toBe('You do not have permission to use this tool.');
    expect(backendRequests.some((r) => r.path === '/api/events')).toBe(false);
  });

  it('a school where the caller has no membership is refused before any write', async () => {
    const json = await callCreateEvent('user-coord', { school_slug: 'school-c' });
    expect(json.error?.code).toBe(-32603);
    expect(backendRequests.some((r) => r.path === '/api/events')).toBe(false);
  });

  it('a parent (member without the coordinator role) is refused at her school', async () => {
    const json = await callCreateEvent('user-parent', { school_slug: 'school-b' });
    expect(json.error?.code).toBe(-32603);
    expect(json.error?.message).toBe('You do not have permission to use this tool.');
    expect(backendRequests.some((r) => r.path === '/api/events')).toBe(false);
  });

  it('no active school and no school_slug: refused with a message that names the parameter', async () => {
    const json = await callCreateEvent('user-coord-null', {});
    expect(json.error?.code).toBe(-32602);
    expect(json.error?.message).toContain('school_slug');
    expect(backendRequests.some((r) => r.path === '/api/events')).toBe(false);
  });

  it('no active school but school_slug given: the coordinator is allowed at that school', async () => {
    const json = await callCreateEvent('user-coord-null', { school_slug: 'school-b' });
    expect(json.error).toBeUndefined();
    expect(backendRequests.find((r) => r.path === '/api/events')?.schoolSlug).toBe('school-b');
  });
});

describe('role-gated tools refuse a school the caller does not belong to (#4128)', () => {
  it.each([
    ['list_school_restaurants', { school_slug: 'school-c' }],
    [
      'schedule_lunch_menu_item',
      { school_slug: 'school-c', restaurant_id: 'r1', menu_item_id: 'm1', menu_date: '2026-12-10' },
    ],
  ])('%s with school_slug %j is refused before any backend call', async (name, args) => {
    backendRequests.length = 0;
    const token = await makeToken('user-coord');
    const res = await request(
      app,
      'https://mcp.paxaver.test/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      },
      ENV,
    );
    const json = (await res.json()) as { error?: { code: number; message: string } };
    expect(json.error?.code).toBe(-32603);
    expect(backendRequests).toEqual([]);
  });
});
