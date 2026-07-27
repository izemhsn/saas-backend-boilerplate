import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Integration tests do real bcrypt (cost 12) + DB work across 19 parallel
    // files — the default 5s timeout causes random flakes under load
    testTimeout: 15_000,
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
