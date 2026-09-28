/**
 * Shared URL helpers.
 */

export function originFrom(url: string): string {
  return new URL(url).origin.replace(/^http:/, 'https:');
}
