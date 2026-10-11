/**
 * Alexa request verification (Amazon "host a custom skill as a web service").
 * https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html
 *
 * 1. SignatureCertChainUrl: https, host s3.amazonaws.com, path under
 *    /echo.api/, port 443 when present (checked after normalization).
 * 2. The certificate chain: every certificate is in its validity dates, the
 *    signing certificate has SAN echo-api.amazon.com, each certificate is
 *    signed by the next one, and the chain ends at a bundled public root.
 * 3. Signature-256: RSASSA-PKCS1-v1_5 / SHA-256 over the raw body bytes.
 * 4. request.timestamp is within 150 seconds of now.
 *
 * Certificates are parsed with @peculiar/asn1-x509; signatures use WebCrypto.
 */

import { AsnConvert } from '@peculiar/asn1-schema';
import {
  BasicConstraints,
  Certificate,
  SubjectAlternativeName,
  id_ce_basicConstraints,
  id_ce_subjectAltName,
} from '@peculiar/asn1-x509';
import { ALEXA_TRUST_ANCHORS } from './roots.js';

const SIGNING_HOST = 'echo-api.amazon.com';
const MAX_SKEW_MS = 150_000;
const RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const RSA_HASHES: Record<string, string> = {
  '1.2.840.113549.1.1.11': 'SHA-256',
  '1.2.840.113549.1.1.12': 'SHA-384',
  '1.2.840.113549.1.1.13': 'SHA-512',
};

export interface VerifyOptions {
  /** Current time in ms (tests). */
  now?: number;
  /** Trust anchors as PEM (tests). Defaults to the bundled Amazon roots. */
  anchors?: readonly string[];
}

interface TrustedChain {
  leafKey: CryptoKey;
  notBefore: number;
  notAfter: number;
}

// Validated chains per trust-anchor set and certificate URL, for this
// isolate. Only successful validations are stored. The URL can change at
// runtime, so it is the key.
const chainCache = new WeakMap<readonly string[], Map<string, TrustedChain>>();

/** Normalize and check SignatureCertChainUrl. Returns the normalized URL, or null. */
export function normalizeCertUrl(value: string | null): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // URL parsing lowercases the scheme and host, resolves dot segments and
  // drops the default port 443.
  url.hash = '';
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== 's3.amazonaws.com') return null;
  if (url.port !== '') return null;
  if (url.username || url.password) return null;
  if (!url.pathname.startsWith('/echo.api/')) return null;
  return url.toString();
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parsePem(pem: string): Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  return blocks.map((block) =>
    AsnConvert.parse(base64ToBytes(block.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')), Certificate),
  );
}

function validity(cert: Certificate): { notBefore: number; notAfter: number } {
  const v = cert.tbsCertificate.validity;
  return { notBefore: v.notBefore.getTime().getTime(), notAfter: v.notAfter.getTime().getTime() };
}

function extension<T>(cert: Certificate, oid: string, type: new () => T): T | null {
  const ext = cert.tbsCertificate.extensions?.find((e) => e.extnID === oid);
  return ext ? AsnConvert.parse(ext.extnValue.buffer, type) : null;
}

function hasSigningSan(cert: Certificate): boolean {
  const san = extension(cert, id_ce_subjectAltName, SubjectAlternativeName);
  return !!san?.some((name) => name.dNSName?.toLowerCase() === SIGNING_HOST);
}

function isCa(cert: Certificate): boolean {
  return !!extension(cert, id_ce_basicConstraints, BasicConstraints)?.cA;
}

function importRsaKey(issuer: Certificate, hash: string): Promise<CryptoKey> | null {
  const spki = issuer.tbsCertificate.subjectPublicKeyInfo;
  if (spki.algorithm.algorithm !== RSA_ENCRYPTION) return null;
  return crypto.subtle.importKey('spki', AsnConvert.serialize(spki), { name: 'RSASSA-PKCS1-v1_5', hash }, false, [
    'verify',
  ]);
}

/** True when `subject` carries a valid signature by `issuer`'s key. RSA only. */
async function isSignedBy(subject: Certificate, issuer: Certificate): Promise<boolean> {
  const hash = RSA_HASHES[subject.signatureAlgorithm.algorithm];
  // The original signed bytes, kept by the parser.
  if (!hash || !subject.tbsCertificateRaw) return false;
  const key = await importRsaKey(issuer, hash);
  if (!key) return false;
  try {
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, subject.signatureValue, subject.tbsCertificateRaw);
  } catch {
    return false;
  }
}

/** Validate the chain. Returns the signing key and the chain's common validity window. */
async function validateChain(chain: Certificate[], anchors: Certificate[], now: number): Promise<TrustedChain | null> {
  const leaf = chain[0];
  if (!leaf || !hasSigningSan(leaf)) return null;

  let notBefore = -Infinity;
  let notAfter = Infinity;
  let trusted = false;
  for (let i = 0; i < chain.length; i++) {
    const current = chain[i]!;
    const window = validity(current);
    if (now < window.notBefore || now > window.notAfter) return null;
    notBefore = Math.max(notBefore, window.notBefore);
    notAfter = Math.min(notAfter, window.notAfter);

    let anchored = false;
    for (const anchor of anchors) {
      if (await isSignedBy(current, anchor)) {
        anchored = true;
        break;
      }
    }
    if (anchored) {
      trusted = true;
      break;
    }

    const next = chain[i + 1];
    if (!next || !isCa(next) || !(await isSignedBy(current, next))) return null;
  }
  if (!trusted) return null;

  const spki = leaf.tbsCertificate.subjectPublicKeyInfo;
  if (spki.algorithm.algorithm !== RSA_ENCRYPTION) return null;
  const leafKey = await crypto.subtle.importKey(
    'spki',
    AsnConvert.serialize(spki),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return { leafKey, notBefore, notAfter };
}

async function trustedChainFor(
  certUrl: string,
  anchorsPem: readonly string[],
  now: number,
): Promise<TrustedChain | null> {
  let cache = chainCache.get(anchorsPem);
  if (!cache) {
    cache = new Map();
    chainCache.set(anchorsPem, cache);
  }
  const cached = cache.get(certUrl);
  if (cached) {
    if (now >= cached.notBefore && now <= cached.notAfter) return cached;
    cache.delete(certUrl);
  }

  const response = await fetch(certUrl);
  if (!response.ok) return null;
  const chain = parsePem(await response.text());
  const anchors = anchorsPem.flatMap(parsePem);
  const trusted = await validateChain(chain, anchors, now);
  if (trusted) cache.set(certUrl, trusted);
  return trusted;
}

/**
 * Verify that a request comes from Alexa. `body` is the raw request body.
 * Returns false on any failure (the caller answers 400).
 */
export async function verifyAlexaRequest(
  headers: Headers,
  body: Uint8Array,
  options: VerifyOptions = {},
): Promise<boolean> {
  const now = options.now ?? Date.now();
  try {
    const certUrl = normalizeCertUrl(headers.get('SignatureCertChainUrl'));
    const signature = headers.get('Signature-256');
    if (!certUrl || !signature) return false;

    const parsed = JSON.parse(new TextDecoder().decode(body)) as { request?: { timestamp?: unknown } };
    const timestamp = typeof parsed.request?.timestamp === 'string' ? Date.parse(parsed.request.timestamp) : NaN;
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_SKEW_MS) return false;

    const chain = await trustedChainFor(certUrl, options.anchors ?? ALEXA_TRUST_ANCHORS, now);
    if (!chain) return false;

    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', chain.leafKey, base64ToBytes(signature), body);
  } catch {
    return false;
  }
}
