import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // env.ts valida process.env na importação; valores mínimos para os testes.
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      PUBLIC_RTMP_URL: 'rtmp://example.test:1935',
    },
  },
});
