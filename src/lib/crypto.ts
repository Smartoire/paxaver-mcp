/**
 * Crypto helpers: SHA-256, random tokens, session IDs, PKCE, OAuth state.
 */

function base64urlEncode(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return toHex(new Uint8Array(hash));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

export function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// --- PKCE (RFC 7636) — S256 only ---

export async function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string,
): Promise<boolean> {
  const buf = new TextEncoder().encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return base64urlEncode(new Uint8Array(hash)) === codeChallenge;
}

// --- OAuth state CSRF token (HMAC) ---

export async function createStateToken(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const sigB64 = base64urlEncode(new Uint8Array(sig));
  return `${payload}.${sigB64}`;
}

export async function verifyStateToken(
  secret: string,
  token: string,
): Promise<string | null> {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx < 1) return null;
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expectedSig = base64urlEncode(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    ),
  );

  // timing-safe comparison
  if (sig.length !== expectedSig.length) return null;
  const a = new TextEncoder().encode(sig);
  const b = new TextEncoder().encode(expectedSig);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0 ? payload : null;
}

// --- Timing-safe string comparison ---

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encA = new TextEncoder().encode(a);
  const encB = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < encA.length; i++) diff |= encA[i]! ^ encB[i]!;
  return diff === 0;
}
