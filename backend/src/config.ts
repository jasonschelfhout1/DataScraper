import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(projectRoot, '.env') });

const cookieHeaderSchema = z.string().min(1).refine(
  (value) => !/[\r\n]/.test(value) && value.split(';').every((part) => /^[^=;\s]+=[^;\r\n]*$/.test(part.trim())),
  'must be a valid Cookie header without line breaks',
);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  OMGEVINGSLOKET_BASE_URL: z.url().refine((value) => new URL(value).protocol === 'https:', 'must use HTTPS').default('https://omgevingsloketinzage.omgeving.vlaanderen.be'),
  OMGEVINGSLOKET_COOKIE_HEADER: cookieHeaderSchema.optional(),
  DEBUG_OMGEVINGSLOKET: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(4).default(3),
  CACHE_TTL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
  DOWNLOAD_JOB_TTL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(900_000),
  MAX_ACTIVE_DOWNLOAD_JOBS: z.coerce.number().int().min(1).max(8).default(2),
  MAX_DOCUMENTS_PER_DOWNLOAD: z.coerce.number().int().min(1).max(250).default(100),
  EXPENSIVE_REQUEST_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  MAX_EXPENSIVE_REQUESTS_PER_WINDOW: z.coerce.number().int().min(1).max(300).default(30),
  LOCAL_DATA_DIR: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = ReturnType<typeof createConfig>;

export function createConfig(environment: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    const key = String(parsed.error.issues[0]?.path[0] ?? 'environment');
    throw new Error(`Invalid configuration: ${key}`);
  }
  const baseUrl = new URL(parsed.data.OMGEVINGSLOKET_BASE_URL);
  return {
    ...parsed.data,
    baseUrl,
    projectRoot,
    localDirectory: resolve(parsed.data.LOCAL_DATA_DIR ?? resolve(projectRoot, '.local')),
    allowedHosts: new Set([baseUrl.hostname]),
  };
}

export const config = createConfig(process.env);
