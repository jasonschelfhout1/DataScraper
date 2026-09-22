import { TaskRepository } from '../backend/src/crawler/task-repository.js';
import { closeDatabase, databasePool } from '../backend/src/db/client.js';

const [minX, minY, maxX, maxY] = process.argv.slice(2).map(Number);
if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
  throw new Error('Usage: npm run crawl:discover -- <minX> <minY> <maxX> <maxY> (EPSG:31370)');
}
try {
  await new TaskRepository(databasePool()).queueDiscovery({ bounds: { minX, minY, maxX, maxY }, page: 0 });
  console.log('Queued public-map discovery for the supplied EPSG:31370 bounding box.');
} finally { await closeDatabase(); }
