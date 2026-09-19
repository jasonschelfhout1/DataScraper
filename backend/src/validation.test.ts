import { describe, expect, it } from 'vitest';
import { assertAllowedUpstreamUrl, parseProjectInput } from './validation.js';

describe('project input validation', () => {
  it('normalizes number, documented prefix, and official URL', () => {
    expect(parseProjectInput('2026045710')).toBe('2026045710');
    expect(parseProjectInput(' OMV_2026045710 ')).toBe('2026045710');
    expect(parseProjectInput('https://omgevingsloketinzage.omgeving.vlaanderen.be/2026045710')).toBe('2026045710');
    expect(parseProjectInput('https://omgevingsloketinzage.omgeving.vlaanderen.be/2026045710/a-phase/an-event')).toBe('2026045710');
  });
  it('rejects malformed and unsafe URLs', () => {
    expect(() => parseProjectInput('202604571')).toThrow();
    expect(() => parseProjectInput('https://example.com/2026045710')).toThrow();
    expect(() => parseProjectInput('https://omgevingsloketinzage.omgeving.vlaanderen.be/2026045710?x=1')).toThrow();
  });
  it('only allows exact upstream hosts', () => {
    expect(() => assertAllowedUpstreamUrl(new URL('https://evil.omgevingsloketinzage.omgeving.vlaanderen.be/x'))).toThrow();
    expect(() => assertAllowedUpstreamUrl(new URL('http://omgevingsloketinzage.omgeving.vlaanderen.be/x'))).toThrow();
  });
});
