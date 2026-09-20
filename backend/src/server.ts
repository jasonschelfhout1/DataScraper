import type { Server } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import pino from 'pino';
import { createApp } from './app.js';
import { config } from './config.js';
import { databasePool } from './db/client.js';
import { PgArchiveRepository } from './db/repositories/archive-repository.js';
import { R2ObjectStore } from './storage/object-store.js';

const shutdownTimeoutMs = 10_000;
const logger = pino({ level: config.LOG_LEVEL });
const app = createApp(new PgArchiveRepository(databasePool()), new R2ObjectStore(), logger);
const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '../../frontend/dist');
if (existsSync(frontend)) {
  app.use(express.static(frontend));
  app.get('/{*path}', (_request, response) => response.sendFile(resolve(frontend, 'index.html')));
} else {
  logger.warn({ frontend }, 'Frontend build directory is unavailable.');
}

const server = app.listen(config.PORT, '0.0.0.0', () => logger.info({ port: config.PORT }, 'API server listening'));
installGracefulShutdown(server);

function installGracefulShutdown(httpServer: Server): void {
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');
    const force = setTimeout(() => {
      logger.warn({ signal }, 'Graceful shutdown timed out');
      process.exit(1);
    }, shutdownTimeoutMs);
    force.unref();
    httpServer.close((error) => {
      clearTimeout(force);
      if (error) {
        logger.error({ err: error }, 'Graceful shutdown failed');
        process.exit(1);
      }
      logger.info({ signal }, 'Graceful shutdown completed');
      process.exit(0);
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
