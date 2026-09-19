import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  OMGEVINGSLOKET_BASE_URL: z.url().default('https://omgevingsloketinzage.omgeving.vlaanderen.be'),
  DEBUG_OMGEVINGSLOKET: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(4).default(3),
  CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  DOWNLOAD_JOB_TTL_MS: z.coerce.number().int().positive().default(900_000),
});

const parsed = envSchema.parse(process.env);
const baseUrl = new URL(parsed.OMGEVINGSLOKET_BASE_URL);

export const config = {
  ...parsed,
  baseUrl,
  allowedHosts: new Set([baseUrl.hostname]),
};
