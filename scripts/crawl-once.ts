import pino from 'pino';
import { ArchiveCrawler } from '../backend/src/crawler/crawler.js';
import { closeDatabase, databasePool } from '../backend/src/db/client.js';
import { config } from '../backend/src/config.js';
import { HttpOmgevingsloketProvider } from '../backend/src/omgevingsloket/http-provider.js';
import { R2ObjectStore } from '../backend/src/storage/object-store.js';

try { await new ArchiveCrawler(databasePool(), new HttpOmgevingsloketProvider(), new R2ObjectStore(), pino({ level: config.LOG_LEVEL })).runBatch(); } finally { await closeDatabase(); }
