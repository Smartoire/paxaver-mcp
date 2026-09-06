import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/mcp/tests/smoke/**/*.ts'],
    environment: 'node',
  },
});
