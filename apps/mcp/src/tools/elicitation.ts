/**
 * MCP elicitation spike (#3682): when a tools/call is missing required
 * arguments and the client declared form-mode elicitation, answer with an
 * InputRequiredResult (multi round-trip requests) instead of -32602. The
 * client collects the values and retries the same call with
 * `params.inputResponses` + `params.requestState`; the signed state binds
 * the retry to this user, tool, field set and a short TTL. Clients
 * without the capability keep the plain -32602 invalid-params error.
 *
 * Form mode accepts flat objects with primitive properties only, so a
 * missing arg whose schema is an array or object (for example `items`)
 * falls back to -32602 — the model asks for it in conversation instead.
 */

import { ALL_TOOLS } from '../schemas.js';
import type { Env, AppVariables } from '../env.js';
import type { RpcId } from './shared.js';

export interface ElicitationContext {
  /** Client declared form-mode elicitation in _meta clientCapabilities. */
  form: boolean;
  inputResponses?: unknown;
  requestState?: unknown;
}

/** Key under which the elicited argument values arrive in inputResponses. */
const INPUT_KEY = 'tool_args';
const STATE_TTL_MS = 15 * 60 * 1000;
const PRIMITIVE_TYPES = new Set(['string', 'number', 'integer', 'boolean']);

// Keys a form-mode requestedSchema may carry (the spec's primitive subset).
const SCHEMA_KEYS = [
  'type',
  'title',
  'description',
  'format',
  'default',
  'enum',
  'oneOf',
  'anyOf',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
];

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text: string): string | null {
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function hmacSha256(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return b64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Required args absent from the call (same emptiness rule as requireArgs). */
export function missingRequiredArgs(args: Record<string, unknown>, required: string[]): string[] {
  return required.filter((n) => args[n] === undefined || args[n] === null || args[n] === '');
}

/** The arg's declared inputSchema property, when it is a primitive type. */
function elicitableProperty(toolName: string, argName: string): Record<string, unknown> | null {
  const tool = ALL_TOOLS.find((t) => t.name === toolName);
  const prop = tool?.inputSchema.properties?.[argName];
  if (!prop || typeof prop !== 'object') return null;
  const p = prop as Record<string, unknown>;
  const type = Array.isArray(p.type) ? p.type.find((t) => t !== 'null') : p.type;
  return typeof type === 'string' && PRIMITIVE_TYPES.has(type) ? p : null;
}

/** True when every missing arg can be collected through a form elicitation. */
export function allElicitable(toolName: string, missing: string[]): boolean {
  return missing.length > 0 && missing.every((arg) => elicitableProperty(toolName, arg) !== null);
}

function sanitizeSchema(prop: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SCHEMA_KEYS) {
    if (prop[key] !== undefined) out[key] = prop[key];
  }
  return out;
}

/**
 * Build the InputRequiredResult for a call missing required args, or null
 * when the client cannot take elicitation or an arg is not primitive.
 */
export async function buildInputRequired(
  id: RpcId,
  toolName: string,
  missing: string[],
  ctx: AppVariables,
  env: Env,
  elicitation: ElicitationContext,
): Promise<Response | null> {
  if (!elicitation.form || !allElicitable(toolName, missing)) return null;

  const properties: Record<string, unknown> = {};
  for (const arg of missing) {
    const prop = elicitableProperty(toolName, arg);
    if (prop) properties[arg] = sanitizeSchema(prop);
  }

  const payload = JSON.stringify({
    v: 1,
    u: ctx.userId,
    t: toolName,
    f: missing,
    exp: Date.now() + STATE_TTL_MS,
  });
  const payloadB64 = b64urlEncode(payload);
  const key = env.INTERNAL_SERVICE_SECRET ?? ctx.userToken ?? '';
  const signature = key ? await hmacSha256(key, payloadB64) : '';
  const requestState = signature ? `${payloadB64}.${signature}` : payloadB64;

  return Response.json({
    jsonrpc: '2.0',
    id,
    result: {
      resultType: 'input_required',
      inputRequests: {
        [INPUT_KEY]: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: `Paxaver needs the following to continue: ${missing.join(', ')}.`,
            requestedSchema: { type: 'object', properties, required: missing },
          },
        },
      },
      requestState,
    },
  });
}

/**
 * Verify requestState and merge accepted elicitation content into args.
 * Returns true only for a state this server minted for this user and
 * tool inside its TTL — anything else is ignored (the call then fails
 * on its missing args as usual).
 */
export async function applyElicitedArgs(
  args: Record<string, unknown>,
  toolName: string,
  ctx: AppVariables,
  env: Env,
  elicitation: ElicitationContext,
): Promise<boolean> {
  const state = elicitation.requestState;
  if (typeof state !== 'string' || !state) return false;
  const dot = state.lastIndexOf('.');
  const payloadB64 = dot > 0 ? state.slice(0, dot) : state;
  const signature = dot > 0 ? state.slice(dot + 1) : '';
  const key = env.INTERNAL_SERVICE_SECRET ?? ctx.userToken ?? '';
  if (!key) return false;
  const expected = await hmacSha256(key, payloadB64);
  if (!timingSafeEqual(signature, expected)) return false;

  const decoded = b64urlDecode(payloadB64);
  if (!decoded) return false;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (
    parsed.v !== 1 ||
    parsed.u !== ctx.userId ||
    parsed.t !== toolName ||
    typeof parsed.exp !== 'number' ||
    parsed.exp < Date.now() ||
    !Array.isArray(parsed.f)
  ) {
    return false;
  }
  const fields = (parsed.f as unknown[]).filter((f): f is string => typeof f === 'string');

  const responses = elicitation.inputResponses;
  const entry =
    responses && typeof responses === 'object' ? (responses as Record<string, unknown>)[INPUT_KEY] : undefined;
  if (!entry || typeof entry !== 'object') return true; // valid retry, nothing accepted
  const result = entry as Record<string, unknown>;
  if (result.action !== 'accept') return true; // declined/cancelled — leave args missing
  const content = result.content;
  if (content && typeof content === 'object') {
    const values = content as Record<string, unknown>;
    for (const field of fields) {
      if (values[field] !== undefined) args[field] = values[field];
    }
  }
  return true;
}
