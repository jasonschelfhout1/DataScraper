import { closeDatabase, databasePool } from '../backend/src/db/client.js';
import { PgArchiveRepository } from '../backend/src/db/repositories/archive-repository.js';
try { console.log(JSON.stringify(await new PgArchiveRepository(databasePool()).stats(), null, 2)); } finally { await closeDatabase(); }
