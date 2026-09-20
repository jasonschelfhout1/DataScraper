import { closeDatabase, databasePool } from './client.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migration = resolve(process.cwd(), 'drizzle', '0000_archive_initial.sql');
try {
  await databasePool().query(await readFile(migration, 'utf8'));
  console.log('Database migration completed.');
} finally {
  await closeDatabase();
}
