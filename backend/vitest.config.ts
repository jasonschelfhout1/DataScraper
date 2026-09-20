import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      AUTH_USERNAME: 'test-user',
      AUTH_PASSWORD: 'test-password',
      AUTH_SESSION_SECRET: 'test-session-secret-with-at-least-thirty-two-characters',
    },
  },
});
