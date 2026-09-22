import { Pool, type PoolClient } from 'pg';
import { closeDatabase, databasePool } from '../backend/src/db/client.js';

const sourceUrl = process.env.SOURCE_DATABASE_URL;
if (!sourceUrl) throw new Error('SOURCE_DATABASE_URL is required and must point to the local archive database.');
const replacePartialImport = process.argv.includes('--replace-partial-import');

const tables = ['crawler_state', 'projects', 'project_phases', 'events', 'documents', 'discovery_partitions', 'crawl_tasks', 'crawl_runs'] as const;
const source = new Pool({ connectionString: sourceUrl });
const destination = databasePool();

try {
  let destinationIsEmpty = true;
  for (const table of tables) {
    const targetCount = await countRows(destination, table);
    if (targetCount !== 0) destinationIsEmpty = false;
  }
  if (!destinationIsEmpty && !replacePartialImport) throw new Error('Destination archive tables are not empty; refusing to merge or overwrite archive data.');
  if (!destinationIsEmpty) {
    const unsafeTables = ['documents', 'project_phases', 'events', 'crawl_tasks', 'crawl_runs', 'discovery_partitions'] as const;
    for (const table of unsafeTables) if (await countRows(destination, table) !== 0) throw new Error('Destination contains archive data; refusing to replace it.');
    await destination.query(`TRUNCATE TABLE crawler_state, projects, project_phases, events, documents, discovery_partitions, crawl_tasks, crawl_runs CASCADE`);
    console.log('Cleared the known partial import before retrying.');
  }

  const client = await destination.connect();
  try {
    await client.query('BEGIN');
    for (const table of tables) {
      const rows = (await source.query(`SELECT * FROM ${table}`)).rows;
      await insertRows(client, table, rows);
      const targetCount = await countRows(client, table);
      if (targetCount !== rows.length) throw new Error(`Verification failed while importing ${table}.`);
      console.log(`Imported ${rows.length} ${table} rows.`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  console.log('Local archive metadata import completed. R2 objects were not copied because they already exist in the same private bucket.');
} finally {
  await source.end();
  await closeDatabase();
}

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

async function countRows(pool: Queryable, table: (typeof tables)[number]): Promise<number> {
  const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function insertRows(pool: Queryable, table: (typeof tables)[number], rows: Array<Record<string, unknown>>): Promise<void> {
  if (!rows.length) return;
  const columns = Object.keys(rows[0] ?? {});
  if (!columns.every((column) => /^[a-z_][a-z0-9_]*$/.test(column))) throw new Error(`Unexpected column name while importing ${table}.`);
  const batchSize = 100;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch.flatMap((row) => columns.map((column) => row[column]));
    const placeholders = batch.map((_, rowIndex) => `(${columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(', ')})`).join(', ');
    await pool.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`, values);
  }
}
