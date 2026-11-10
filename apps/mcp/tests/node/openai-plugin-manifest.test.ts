/**
 * OpenAI plugin manifest checks: .codex-plugin/plugin.json must meet the
 * current OpenAI limits (field lengths, required interface fields, HTTPS
 * URLs) and its icon files must exist as square PNGs of at least 48 px.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_TOOLS } from '../../src/schemas.js';

const ROOT = resolve(process.cwd());
const manifest = JSON.parse(readFileSync(resolve(ROOT, '.codex-plugin/plugin.json'), 'utf8')) as {
  version: string;
  interface: Record<string, unknown> & {
    displayName: string;
    shortDescription: string;
    longDescription: string;
  };
  extensions?: {
    'com.openai'?: {
      review?: {
        test_cases?: {
          positive?: Array<Record<string, unknown>>;
          negative?: Array<Record<string, unknown>>;
        };
      };
    };
  };
};
const testCases = manifest.extensions?.['com.openai']?.review?.test_cases;
const ui = manifest.interface;

// Category values offered by the OpenAI Plugins dashboard. Only the two named
// in the OpenAI docs are listed here; extend this when the dropdown shows more.
const DASHBOARD_CATEGORIES = ['Productivity', 'Developer Tools'];
const REQUIRED_URLS = ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'] as const;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(path: string): { width: number; height: number } {
  const bytes = new Uint8Array(readFileSync(path));
  expect(
    PNG_SIG.every((b, i) => bytes[i] === b),
    `${path} is not a PNG`,
  ).toBe(true);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('OpenAI plugin manifest', () => {
  it('has a version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps displayName and shortDescription within 30 characters', () => {
    expect(ui.displayName.length).toBeLessThanOrEqual(30);
    expect(ui.shortDescription.length).toBeLessThanOrEqual(30);
  });

  it('keeps longDescription within 4000 characters', () => {
    expect(ui.longDescription.length).toBeGreaterThan(0);
    expect(ui.longDescription.length).toBeLessThanOrEqual(4000);
  });

  it('uses a category from the OpenAI dashboard list', () => {
    expect(DASHBOARD_CATEGORIES).toContain(ui.category);
  });

  it('uses HTTPS for every URL field', () => {
    for (const key of REQUIRED_URLS) {
      const value = ui[key];
      expect(typeof value, key).toBe('string');
      expect(new URL(value as string).protocol, key).toBe('https:');
    }
  });

  it('declares the required interface fields', () => {
    for (const key of [...REQUIRED_URLS, 'composerIcon', 'logo', 'longDescription']) {
      expect(ui[key], key).toBeTruthy();
    }
  });

  it('has 5 positive and 3 negative review test cases with the required fields', () => {
    expect(testCases?.positive?.length).toBe(5);
    expect(testCases?.negative?.length).toBe(3);
    for (const c of testCases?.positive ?? []) {
      for (const key of ['description', 'prompt', 'tools_triggered', 'expected_behavior']) {
        expect(typeof c[key], `positive.${key}`).toBe('string');
      }
    }
    for (const c of testCases?.negative ?? []) {
      for (const key of ['description', 'prompt']) {
        expect(typeof c[key], `negative.${key}`).toBe('string');
      }
    }
  });

  it('names only real tools in tools_triggered', () => {
    const toolNames = new Set(ALL_TOOLS.map((t) => t.name));
    for (const c of testCases?.positive ?? []) {
      const names = String(c.tools_triggered)
        .split(',')
        .map((n) => n.trim());
      for (const name of names) {
        expect(toolNames.has(name), `unknown tool ${name}`).toBe(true);
      }
    }
  });

  it('ships the icon files as square PNGs of at least 48 px', () => {
    for (const key of ['composerIcon', 'logo']) {
      const rel = ui[key] as string;
      // Icon paths are relative to the plugin root, which is the repo root.
      const path = resolve(ROOT, rel);
      expect(existsSync(path), `${key} file ${rel}`).toBe(true);
      const { width, height } = pngSize(path);
      expect(width, key).toBe(height);
      expect(width, key).toBeGreaterThanOrEqual(48);
    }
  });
});
