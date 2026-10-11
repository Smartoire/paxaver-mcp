/**
 * Single source of truth for the server version.
 *
 * Read from package.json at bundle time so the health endpoint,
 * discovery server card, and JSON-RPC serverInfo cannot drift.
 */

import pkg from '../../../../package.json';

export const SERVER_VERSION: string = pkg.version;
