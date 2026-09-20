import { describe, expect, it } from 'vitest';
import { createConfig } from './config.js';

describe('production configuration', () => {
  const productionAuth = {
    NODE_ENV: 'production',
    AUTH_USERNAME: 'test-user',
    AUTH_PASSWORD: 'test-password',
    AUTH_SESSION_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://user:password@localhost:5432/datascraper_test',
  };
  it('fails without exposing a malformed secret', () => {
    const secret = 'session=secret\nInjected: value';
    expect(() => createConfig({ ...productionAuth, OMGEVINGSLOKET_COOKIE_HEADER: secret })).toThrow('Invalid configuration: OMGEVINGSLOKET_COOKIE_HEADER');
    try { createConfig({ ...productionAuth, OMGEVINGSLOKET_COOKIE_HEADER: secret }); } catch (error) { expect(String(error)).not.toContain(secret); }
  });
  it('uses an explicit temporary local data directory', () => {
    expect(createConfig({ ...productionAuth, LOCAL_DATA_DIR: '/tmp/datascraper-test' }).localDirectory).toContain('datascraper-test');
  });
  it('fails closed when production authentication secrets are missing', () => {
    expect(createConfig({ NODE_ENV: 'production' }).AUTH_USERNAME).toBeUndefined();
    const secret = 'this-must-not-appear-in-the-configuration-error';
    expect(() => createConfig({ ...productionAuth, AUTH_USERNAME: 'user', AUTH_PASSWORD: 'password', AUTH_SESSION_SECRET: secret })).not.toThrow();
  });
  it('does not expose a rejected authentication secret', () => {
    const secret = 'too-short-secret';
    try { createConfig({ ...productionAuth, AUTH_USERNAME: 'user', AUTH_PASSWORD: 'password', AUTH_SESSION_SECRET: secret }); } catch (error) {
      expect(String(error)).toContain('AUTH_SESSION_SECRET');
      expect(String(error)).not.toContain(secret);
    }
  });
});
