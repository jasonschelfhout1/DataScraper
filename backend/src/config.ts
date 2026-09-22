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
const optionalNonEmptyString = z.preprocess((value) => value === '' ? undefined : value, z.string().trim().min(1).optional());
const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional());
const optionalCookieHeader = z.preprocess((value) => value === '' ? undefined : value, cookieHeaderSchema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  OMGEVINGSLOKET_BASE_URL: z.url().refine((value) => new URL(value).protocol === 'https:', 'must use HTTPS').default('https://omgevingsloketinzage.omgeving.vlaanderen.be'),
  OMGEVINGSLOKET_COOKIE_HEADER: optionalCookieHeader,
  DEBUG_OMGEVINGSLOKET: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(4).default(3),
  CACHE_TTL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
  DOWNLOAD_JOB_TTL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(900_000),
  MAX_ACTIVE_DOWNLOAD_JOBS: z.coerce.number().int().min(1).max(8).default(2),
  MAX_DOCUMENTS_PER_DOWNLOAD: z.coerce.number().int().min(1).max(250).default(100),
  EXPENSIVE_REQUEST_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  MAX_EXPENSIVE_REQUESTS_PER_WINDOW: z.coerce.number().int().min(1).max(300).default(30),
  AUTH_USERNAME: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().min(1).max(100).optional()),
  AUTH_PASSWORD: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).max(500).optional()),
  AUTH_SESSION_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).max(500).optional()),
  AUTH_SESSION_MAX_AGE_MS: z.coerce.number().int().min(60_000).max(604_800_000).default(86_400_000),
  AUTH_LOGIN_WINDOW_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(900_000),
  AUTH_MAX_LOGIN_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  DATABASE_URL: optionalUrl,
  R2_ACCESS_KEY_ID: optionalNonEmptyString,
  R2_SECRET_ACCESS_KEY: optionalNonEmptyString,
  R2_BUCKET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(3).max(255).optional()),
  R2_ENDPOINT: optionalUrl,
  R2_REGION: z.string().min(1).default('auto'),
  // Kept below Cloudflare R2's 10 GB monthly Standard-storage allowance.
  ARCHIVE_MAX_STORAGE_BYTES: z.coerce.number().int().min(1_073_741_824).max(8_589_934_592).default(8_589_934_592),
  CRAWLER_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
  CRAWLER_MIN_REQUEST_DELAY_MS: z.coerce.number().int().min(1_000).max(60_000).default(3_000),
  CRAWLER_REQUEST_JITTER_MS: z.coerce.number().int().min(0).max(30_000).default(2_000),
  CRAWLER_BATCH_MAX_MS: z.coerce.number().int().min(60_000).max(1_800_000).default(480_000),
  CRAWLER_MAX_TASKS_PER_RUN: z.coerce.number().int().min(1).max(5_000).default(500),
  CRAWLER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  CRAWLER_TASK_LEASE_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(900_000),
  CRAWLER_RETRY_BASE_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  CRAWL_TASK_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
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
    isProduction: parsed.data.NODE_ENV === 'production',
  };
}

export function requireObjectStorageConfig() {
  const required = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT'] as const;
  for (const key of required) if (!config[key]) throw new Error(`Invalid configuration: ${key}`);
  return {
    accessKeyId: config.R2_ACCESS_KEY_ID!, secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
    bucket: config.R2_BUCKET!, endpoint: config.R2_ENDPOINT!, region: config.R2_REGION,
  };
}

export const config = createConfig(process.env);

/** Called only by the web server; crawler/discovery tools do not need app-login credentials. */
export function requireAuthenticationConfig() {
  for (const key of ['AUTH_USERNAME', 'AUTH_PASSWORD', 'AUTH_SESSION_SECRET'] as const) {
    if (!config[key]) throw new Error(`Invalid configuration: ${key}`);
  }
  return { username: config.AUTH_USERNAME!, password: config.AUTH_PASSWORD!, sessionSecret: config.AUTH_SESSION_SECRET! };
}
