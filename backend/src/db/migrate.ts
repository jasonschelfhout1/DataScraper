import { closeDatabase, databasePool } from './client.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migration = resolve(process.cwd(), 'drizzle', '0000_archive_initial.sql');
try {
  const pool = databasePool();
  const existing = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('projects', 'documents', 'crawl_tasks')`);
  if (existing.rows.length === 0) {
    await pool.query(await readFile(migration, 'utf8'));
    console.log('Database migration completed.');
  } else if (existing.rows.length === 3) {
    console.log('Database archive schema already exists.');
  } else {
    throw new Error('Database contains an incomplete archive schema; refusing to apply an unsafe partial migration.');
  }
} finally {
  await closeDatabase();
}
