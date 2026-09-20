import pino from 'pino';
import { ArchiveCrawler } from '../backend/src/crawler/crawler.js';
import { closeDatabase, databasePool } from '../backend/src/db/client.js';
import { config } from '../backend/src/config.js';
import { HttpOmgevingsloketProvider } from '../backend/src/omgevingsloket/http-provider.js';
import { R2ObjectStore } from '../backend/src/storage/object-store.js';

const crawler = new ArchiveCrawler(databasePool(), new HttpOmgevingsloketProvider(), new R2ObjectStore(), pino({ level: config.LOG_LEVEL }));
let stopping = false; process.once('SIGTERM', () => { stopping = true; }); process.once('SIGINT', () => { stopping = true; });
try { while (!stopping) { await crawler.runBatch(); await new Promise((resolve) => setTimeout(resolve, 30_000)); } } finally { await closeDatabase(); }
