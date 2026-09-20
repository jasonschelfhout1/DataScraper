import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCookieHeaderFrom } from './session.js';

describe('session sources', () => {
  it('prefers the environment-provided authorized cookie header', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'datascraper-session-'));
    const path = join(directory, 'session.json');
    await writeFile(path, JSON.stringify({ savedAt: new Date().toISOString(), cookies: [{ name: 'local', value: 'value', domain: 'omgevingsloketinzage.omgeving.vlaanderen.be' }] }));
    await expect(loadCookieHeaderFrom('production=value', path)).resolves.toBe('production=value');
  });
  it('uses a valid local session when no production secret exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'datascraper-session-'));
    const path = join(directory, 'session.json');
    await writeFile(path, JSON.stringify({ savedAt: new Date().toISOString(), cookies: [{ name: 'local', value: 'value', domain: 'omgevingsloketinzage.omgeving.vlaanderen.be' }] }));
    await expect(loadCookieHeaderFrom(undefined, path)).resolves.toBe('local=value');
  });
  it('fails safely for malformed local session storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'datascraper-session-'));
    const path = join(directory, 'session.json');
    await writeFile(path, '{not json');
    await expect(loadCookieHeaderFrom(undefined, path)).resolves.toBeUndefined();
  });
});
