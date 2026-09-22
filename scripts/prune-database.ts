import { config } from '../backend/src/config.js';
import { closeDatabase, databasePool } from '../backend/src/db/client.js';
import { pruneCompletedCrawlTasks } from '../backend/src/db/prune.js';

try {
  const result = await pruneCompletedCrawlTasks(databasePool(), config.CRAWL_TASK_RETENTION_DAYS);
  console.log(`Pruned ${result.completedTasksDeleted} completed crawl tasks older than ${config.CRAWL_TASK_RETENTION_DAYS} days.`);
} finally {
  await closeDatabase();
}
