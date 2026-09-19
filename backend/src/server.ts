import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import pino from 'pino';
import { createApp } from './app.js';
import { config } from './config.js';
import { DiscoveryRequiredProvider } from './omgevingsloket/provider.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const app = createApp(new DiscoveryRequiredProvider(), logger);
const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '../../frontend/dist');
if (existsSync(frontend)) {
  app.use(express.static(frontend));
  app.get('/api/{*path}', (_request, response) => response.status(404).json({ code: 'NOT_FOUND', message: 'API route not found.' }));
  app.get('/{*path}', (_request, response) => response.sendFile(resolve(frontend, 'index.html')));
}
app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'API server listening'));
