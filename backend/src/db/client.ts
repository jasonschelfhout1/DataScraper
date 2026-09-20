import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config.js';

let pool: Pool | undefined;

export function databasePool(): Pool {
  if (!config.DATABASE_URL) throw new Error('Invalid configuration: DATABASE_URL');
  pool ??= new Pool({ connectionString: config.DATABASE_URL, max: 5, idleTimeoutMillis: 30_000 });
  return pool;
}

export const db = () => drizzle(databasePool());

export async function closeDatabase(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.end();
}
