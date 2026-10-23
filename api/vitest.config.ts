import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // env.ts valida process.env na importação; valores mínimos para os testes.
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      PUBLIC_RTMP_URL: 'rtmp://example.test:1935',
      KLAVI_API_URL: 'https://klavi.example.test',
      KLAVI_USERNAME: 'gestor@example.test',
      KLAVI_PASSWORD: 'senha-de-teste',
    },
  },
});
