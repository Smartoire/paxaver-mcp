/**
 * Alexa request verification: certificate URL rules, chain trust, body
 * signature and timestamp window.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeCertUrl, verifyAlexaRequest } from '../src/alexa/verify-request.js';
import { makeAlexaChain, makeCert, signBody, type TestCert } from './alexa-certs.js';

const DAY = 86_400_000;
const served = new Map<string, string>();
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  fetched.push(url);
  const pem = served.get(url);
  return pem ? new Response(pem) : new Response('not found', { status: 404 });
});

let counter = 0;
/** Serve a chain at a fresh URL (the verifier caches per URL). */
function serve(pem: string): string {
  const url = `https://s3.amazonaws.com/echo.api/test-${++counter}.pem`;
  served.set(url, pem);
  return url;
}

function alexaBody(timestamp = new Date().toISOString()): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ version: '1.0', request: { type: 'LaunchRequest', timestamp } }));
}

async function signedHeaders(leaf: TestCert, url: string, body: Uint8Array): Promise<Headers> {
  return new Headers({ SignatureCertChainUrl: url, 'Signature-256': await signBody(leaf, body) });
}

beforeEach(() => {
  fetched.length = 0;
});

describe('normalizeCertUrl', () => {
  it.each([
    ['https://s3.amazonaws.com/echo.api/echo-api-cert.pem', true],
    ['https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem', true],
    ['HTTPS://s3.amazonaws.com/echo.api/echo-api-cert.pem', true],
    ['https://S3.AMAZONAWS.COM/echo.api/echo-api-cert.pem', true],
    ['https://s3.amazonaws.com/echo.api/../echo.api/echo-api-cert.pem', true],
    ['https://s3.amazonaws.com//echo.api//echo-api-cert.pem', true],
    ['http://s3.amazonaws.com/echo.api/echo-api-cert.pem', false],
    ['https://notamazon.com/echo.api/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com.evil.example/echo.api/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com/ECHO.API/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com/invalid.path/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com/echo.api/../invalid.path/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem', false],
    ['https://s3.amazonaws.com:8443/echo.api/echo-api-cert.pem', false],
    ['https://user:pw@s3.amazonaws.com/echo.api/echo-api-cert.pem', false],
    ['not a url', false],
  ])('%s → %s', (url, valid) => {
    expect(normalizeCertUrl(url) !== null).toBe(valid);
  });

  it('removes dot segments and the fragment', () => {
    expect(normalizeCertUrl('https://s3.amazonaws.com/echo.api/../echo.api/cert.pem#x')).toBe(
      'https://s3.amazonaws.com/echo.api/cert.pem',
    );
  });
});

describe('verifyAlexaRequest', () => {
  it('accepts a correctly signed request', async () => {
    const { root, leaf, chainPem } = await makeAlexaChain();
    const body = alexaBody();
    const url = serve(chainPem);

    expect(await verifyAlexaRequest(await signedHeaders(leaf, url, body), body, { anchors: [root.pem] })).toBe(true);
  });

  it('caches the validated chain per URL', async () => {
    const { root, leaf, chainPem } = await makeAlexaChain();
    const url = serve(chainPem);
    const anchors = [root.pem];
    for (let i = 0; i < 2; i++) {
      const body = alexaBody();
      expect(await verifyAlexaRequest(await signedHeaders(leaf, url, body), body, { anchors })).toBe(true);
    }
    expect(fetched.filter((u) => u === url)).toHaveLength(1);
  });

  it('does not reuse a chain cached under other trust anchors', async () => {
    const { root, leaf, chainPem } = await makeAlexaChain();
    const url = serve(chainPem);
    const body = alexaBody();
    const headers = await signedHeaders(leaf, url, body);
    expect(await verifyAlexaRequest(headers, body, { anchors: [root.pem] })).toBe(true);
    // The bundled Amazon roots do not trust the test chain.
    expect(await verifyAlexaRequest(headers, body)).toBe(false);
  });

  it('rejects a body changed by one byte', async () => {
    const { root, leaf, chainPem } = await makeAlexaChain();
    const body = alexaBody();
    const headers = await signedHeaders(leaf, serve(chainPem), body);
    const tampered = body.slice();
    const index = tampered.length - 2;
    tampered[index] = tampered[index]! ^ 1;

    expect(await verifyAlexaRequest(headers, tampered, { anchors: [root.pem] })).toBe(false);
  });

  it('rejects a bad Signature-256', async () => {
    const { root, chainPem } = await makeAlexaChain();
    const other = await makeCert({ subject: 'other' });
    const body = alexaBody();

    expect(
      await verifyAlexaRequest(await signedHeaders(other, serve(chainPem), body), body, { anchors: [root.pem] }),
    ).toBe(false);
  });

  it('rejects a missing signature or URL', async () => {
    const body = alexaBody();
    expect(await verifyAlexaRequest(new Headers(), body)).toBe(false);
    expect(await verifyAlexaRequest(new Headers({ 'Signature-256': 'AAAA' }), body)).toBe(false);
  });

  it('rejects a URL that fails the rules without fetching it', async () => {
    const { root, leaf, chainPem } = await makeAlexaChain();
    const body = alexaBody();
    const url = serve(chainPem).replace('/echo.api/', '/ECHO.API/');

    expect(await verifyAlexaRequest(await signedHeaders(leaf, url, body), body, { anchors: [root.pem] })).toBe(false);
    expect(fetched).toHaveLength(0);
  });

  it('rejects a chain that does not end at a trusted root', async () => {
    const { leaf, chainPem } = await makeAlexaChain();
    const otherRoot = await makeCert({ subject: 'Other Root', ca: true });
    const body = alexaBody();

    expect(
      await verifyAlexaRequest(await signedHeaders(leaf, serve(chainPem), body), body, { anchors: [otherRoot.pem] }),
    ).toBe(false);
  });

  it('rejects a broken chain (intermediate missing)', async () => {
    const { root, leaf } = await makeAlexaChain();
    const body = alexaBody();

    expect(
      await verifyAlexaRequest(await signedHeaders(leaf, serve(leaf.pem), body), body, { anchors: [root.pem] }),
    ).toBe(false);
  });

  it('rejects an issuer that is not a CA', async () => {
    const root = await makeCert({ subject: 'Test Root', ca: true });
    const notCa = await makeCert({ subject: 'Not a CA', issuer: root });
    const leaf = await makeCert({ subject: 'leaf', issuer: notCa, san: 'echo-api.amazon.com' });
    const body = alexaBody();

    expect(
      await verifyAlexaRequest(await signedHeaders(leaf, serve(leaf.pem + notCa.pem), body), body, {
        anchors: [root.pem],
      }),
    ).toBe(false);
  });

  it('rejects a signing certificate without SAN echo-api.amazon.com', async () => {
    const { root, leaf, chainPem } = await makeAlexaChain({ san: 'example.com' });
    const body = alexaBody();

    expect(
      await verifyAlexaRequest(await signedHeaders(leaf, serve(chainPem), body), body, { anchors: [root.pem] }),
    ).toBe(false);
  });

  it('rejects an expired signing certificate', async () => {
    const { root, leaf, chainPem } = await makeAlexaChain({
      notBefore: Date.now() - 10 * DAY,
      notAfter: Date.now() - DAY,
    });
    const body = alexaBody();

    expect(
      await verifyAlexaRequest(await signedHeaders(leaf, serve(chainPem), body), body, { anchors: [root.pem] }),
    ).toBe(false);
  });

  it.each([
    [-151_000, false],
    [-149_000, true],
    [149_000, true],
    [151_000, false],
  ])('timestamp offset %i ms → %s', async (offset, valid) => {
    const { root, leaf, chainPem } = await makeAlexaChain();
    const now = Date.now();
    const body = alexaBody(new Date(now + offset).toISOString());

    expect(
      await verifyAlexaRequest(await signedHeaders(leaf, serve(chainPem), body), body, { anchors: [root.pem], now }),
    ).toBe(valid);
  });

  it('the published Amazon echo-api chain ends at the bundled roots', async () => {
    // Real chain published by Amazon (echo-api-cert-12.pem, valid in 2023).
    const pem = readFileSync(resolve(__dirname, 'fixtures/echo-api-cert-12.pem'), 'utf-8');
    const url = serve(pem);
    const now = Date.parse('2023-06-01T00:00:00Z');
    const body = alexaBody(new Date(now).toISOString());
    // No Amazon private key: a bad signature must be the only failure, so
    // check the chain through the cache. A valid chain is cached; the
    // second call must not fetch again.
    const headers = new Headers({ SignatureCertChainUrl: url, 'Signature-256': 'AAAA' });
    expect(await verifyAlexaRequest(headers, body, { now })).toBe(false);
    expect(await verifyAlexaRequest(headers, body, { now })).toBe(false);
    expect(fetched.filter((u) => u === url)).toHaveLength(1);
  });

  it('the published Amazon chain is not trusted under other roots', async () => {
    const pem = readFileSync(resolve(__dirname, 'fixtures/echo-api-cert-12.pem'), 'utf-8');
    const url = serve(pem);
    const otherRoot = await makeCert({ subject: 'Other Root', ca: true });
    const now = Date.parse('2023-06-01T00:00:00Z');
    const body = alexaBody(new Date(now).toISOString());
    const headers = new Headers({ SignatureCertChainUrl: url, 'Signature-256': 'AAAA' });
    await verifyAlexaRequest(headers, body, { now, anchors: [otherRoot.pem] });
    await verifyAlexaRequest(headers, body, { now, anchors: [otherRoot.pem] });
    // Not cached: an untrusted chain is fetched again.
    expect(fetched.filter((u) => u === url)).toHaveLength(2);
  });
});
