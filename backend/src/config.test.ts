import { describe, expect, it } from 'vitest';
import { createConfig } from './config.js';

describe('production configuration', () => {
  it('fails without exposing a malformed secret', () => {
    const secret = 'session=secret\nInjected: value';
    expect(() => createConfig({ OMGEVINGSLOKET_COOKIE_HEADER: secret })).toThrow('Invalid configuration: OMGEVINGSLOKET_COOKIE_HEADER');
    try { createConfig({ OMGEVINGSLOKET_COOKIE_HEADER: secret }); } catch (error) { expect(String(error)).not.toContain(secret); }
  });
  it('uses an explicit temporary local data directory', () => {
    expect(createConfig({ LOCAL_DATA_DIR: '/tmp/datascraper-test' }).localDirectory).toContain('datascraper-test');
  });
});
