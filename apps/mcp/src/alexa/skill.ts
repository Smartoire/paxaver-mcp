/**
 * POST /alexa — Alexa skill endpoint.
 *
 * Verifies that the request comes from Amazon and from this skill, then
 * forwards the raw body to the user's regional backend. The region comes
 * from the access token issuer. This worker only routes: it does not verify
 * the token. The regional backend verifies the issuer, signature, client and
 * scope, so a forged issuer only reaches a backend that rejects it.
 */

import { decodeJwt } from 'jose';
import type { Env } from '../env.js';
import { forwardToRegion } from '../api/client.js';
import { regionFromIssuer } from '../lib/regions.js';
import { verifyAlexaRequest } from './verify-request.js';

const SKILL_PATH = '/api/assistant/alexa';

interface AlexaBody {
  context?: { System?: { application?: { applicationId?: string }; user?: { accessToken?: string } } };
  session?: { application?: { applicationId?: string }; user?: { accessToken?: string } };
  request?: { type?: string };
}

let warnedNoSkillId = false;
function warnNoSkillId(): void {
  if (!warnedNoSkillId) {
    warnedNoSkillId = true;
    console.warn('[alexa] ALEXA_SKILL_ID unset — skill requests rejected');
  }
}

function speech(text: string, linkAccount: boolean): Response {
  return Response.json({
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      ...(linkAccount ? { card: { type: 'LinkAccount' } } : {}),
      shouldEndSession: true,
    },
  });
}

function badRequest(): Response {
  return new Response(null, { status: 400 });
}

export async function alexaSkill(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const raw = new Uint8Array(await request.arrayBuffer());

  // Development may skip the Amazon checks; staging and production fail closed.
  const development = env.ENVIRONMENT === 'development';
  if (!development && !(await verifyAlexaRequest(request.headers, raw))) return badRequest();

  let body: AlexaBody;
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as AlexaBody;
  } catch {
    return badRequest();
  }

  const appId = body.context?.System?.application?.applicationId ?? body.session?.application?.applicationId;
  if (env.ALEXA_SKILL_ID) {
    if (appId !== env.ALEXA_SKILL_ID) return badRequest();
  } else if (!development) {
    warnNoSkillId();
    return badRequest();
  }

  const token = body.context?.System?.user?.accessToken ?? body.session?.user?.accessToken;
  if (!token) {
    if (body.request?.type === 'SessionEndedRequest') return Response.json({ version: '1.0', response: {} });
    return speech('Please link your Paxaver account in the Alexa app.', true);
  }

  let issuer: string | undefined;
  try {
    const iss = decodeJwt(token).iss;
    issuer = typeof iss === 'string' ? iss : undefined;
  } catch {
    // Malformed token: answer with the relink response below.
  }
  const region = regionFromIssuer(env, issuer);
  if (!region) return speech('Your Paxaver session has expired. Please relink your account.', true);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (env.INTERNAL_SERVICE_SECRET) headers['x-internal-secret'] = env.INTERNAL_SERVICE_SECRET;

  try {
    const response = await forwardToRegion(env, region, SKILL_PATH, { method: 'POST', headers, body: raw });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[alexa] skill forward to ${region} failed:`, err instanceof Error ? err.message : String(err));
    return speech('Paxaver is unavailable right now. Please try again later.', false);
  }
}
