/**
 * Microsoft certification package checks: the committed mcptools.json must
 * equal the live tool registry, and every icon the manifest references that
 * is present on disk must be a PNG of the declared size. The 32x32 outline
 * asset is delivered separately (tracked issue #2605); the check activates
 * as soon as the file lands in the package.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_TOOLS } from '../../src/schemas.js';

const PKG = resolve(process.cwd(), 'certification/microsoft');
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngGeometry(path: string): { width: number; height: number; colorType: number } {
  const raw = readFileSync(path);
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  expect(
    PNG_SIG.every((b, i) => bytes[i] === b),
    `${path} is not a PNG`,
  ).toBe(true);
  expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe('IHDR');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), colorType: view.getUint8(25) };
}

describe('Microsoft certification package', () => {
  it('mcptools.json matches ALL_TOOLS exactly', () => {
    const generated = JSON.parse(readFileSync(resolve(PKG, 'mcptools.json'), 'utf-8'));
    expect(generated).toEqual(JSON.parse(JSON.stringify(ALL_TOOLS)));
  });

  it('manifest parses and declares the package icons', () => {
    const manifest = JSON.parse(readFileSync(resolve(PKG, 'manifest.json'), 'utf-8')) as {
      icons?: Record<string, string>;
    };
    expect(manifest.icons?.color).toBe('icons/color.png');
    expect(manifest.icons?.outline).toBe('icons/outline.png');
  });

  it('color icon is a 192x192 PNG', () => {
    const path = resolve(PKG, 'icons/color.png');
    expect(existsSync(path), 'icons/color.png missing — copy the approved brand asset').toBe(true);
    const { width, height, colorType } = pngGeometry(path);
    expect(width).toBe(192);
    expect(height).toBe(192);
    // Teams color icons are full-color; RGBA (6) or RGB (2) are both valid.
    expect([2, 6]).toContain(colorType);
  });

  it('outline icon, once supplied, is a 32x32 PNG with an alpha channel', () => {
    const path = resolve(PKG, 'icons/outline.png');
    if (!existsSync(path)) return; // supplied by #2605
    const { width, height, colorType } = pngGeometry(path);
    expect(width).toBe(32);
    expect(height).toBe(32);
    // Grayscale+alpha (4) or RGBA (6) — the outline icon needs transparency.
    expect([4, 6]).toContain(colorType);
  });
});
