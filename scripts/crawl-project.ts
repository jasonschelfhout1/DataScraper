import { closeDatabase, databasePool } from '../backend/src/db/client.js';
import { config } from '../backend/src/config.js';
import { parseProjectInput } from '../backend/src/validation.js';
const input = process.argv[2]; if (!input) throw new Error('Usage: npm run crawl:project -- <project number>');
const projectNumber = parseProjectInput(input); const pool = databasePool();
try { const project = await pool.query(`INSERT INTO projects (project_number, crawl_status, next_crawl_at) VALUES ($1, 'pending', now()) ON CONFLICT (project_number) DO UPDATE SET next_crawl_at=now(), updated_at=now() RETURNING id`, [projectNumber]); await pool.query(`INSERT INTO crawl_tasks (type, project_id, status, priority, max_attempts) VALUES ('crawl_project', $1, 'pending', 90, $2) ON CONFLICT DO NOTHING`, [project.rows[0].id, config.CRAWLER_MAX_ATTEMPTS]); console.log(`Queued archive crawl for ${projectNumber}.`); } finally { await closeDatabase(); }
