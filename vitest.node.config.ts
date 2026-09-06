import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/mcp/tests/node/**/*.test.ts'],
    environment: 'node',
  },
});
