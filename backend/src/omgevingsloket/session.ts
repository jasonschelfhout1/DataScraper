import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';

const cookieSchema = z.object({ name: z.string().min(1), value: z.string(), domain: z.string(), expires: z.number().optional() });
const sessionSchema = z.object({ savedAt: z.string(), cookies: z.array(cookieSchema) });
export type SessionCookie = z.infer<typeof cookieSchema>;
export const sessionPath = resolve(config.localDirectory, 'omgevingsloket-session.json');

export async function saveSession(cookies: SessionCookie[]): Promise<void> {
  const allowed = cookies.filter((cookie) => config.allowedHosts.has(cookie.domain.replace(/^\./, '')));
  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, JSON.stringify({ savedAt: new Date().toISOString(), cookies: allowed }, null, 2), 'utf8');
  await chmod(sessionPath, 0o600);
}

export async function loadCookieHeader(): Promise<string | undefined> {
  return loadCookieHeaderFrom(config.OMGEVINGSLOKET_COOKIE_HEADER, sessionPath);
}

export async function loadCookieHeaderFrom(environmentHeader: string | undefined, localPath: string): Promise<string | undefined> {
  if (environmentHeader) return environmentHeader;
  try {
    const json: unknown = JSON.parse(await readFile(localPath, 'utf8'));
    const session = sessionSchema.parse(json);
    const now = Date.now() / 1000;
    const valid = session.cookies.filter((cookie) => config.allowedHosts.has(cookie.domain.replace(/^\./, '')) && (cookie.expires === undefined || cookie.expires > now));
    return valid.length ? valid.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') : undefined;
  } catch {
    return undefined;
  }
}
