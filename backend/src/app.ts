import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { configureSession, login, logout, requireAuthentication, sessionStatus } from './auth.js';
import type { ArchiveRepository } from './archive/types.js';
import { config } from './config.js';
import { InputError, parseProjectInput } from './validation.js';
import { loginAttemptLimiter } from './rate-limit.js';
import type { ObjectStore } from './storage/object-store.js';

const searchSchema = z.object({ q: z.string().max(200).default(''), page: z.coerce.number().int().min(0).default(0), size: z.coerce.number().int().min(1).max(100).default(25) });
const documentIdSchema = z.string().uuid();

/** Archive-only web API. It has no Omgevingsloket provider dependency. */
export function createApp(archive: ArchiveRepository, objectStore: ObjectStore, logger: Logger): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(pinoHttp({ logger, serializers: { req: (request) => ({ id: request.id, method: request.method, url: request.url, remoteAddress: request.remoteAddress }), res: (response) => ({ statusCode: response.statusCode }) } }));
  app.use(express.json({ limit: '16kb' }));
  app.use(configureSession());
  app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'datascraper', uptime: Math.floor(process.uptime()) }));
  app.post('/api/auth/login', loginAttemptLimiter(config), login);
  app.post('/api/auth/logout', logout);
  app.get('/api/auth/session', sessionStatus);
  app.use('/api', requireAuthentication);

  app.get('/api/archive/projects', async (request, response, next) => {
    try { const query = searchSchema.parse(request.query); response.json(await archive.searchProjects(query.q, query.page, query.size)); } catch (error) { next(error); }
  });
  app.get('/api/archive/projects/:projectNumber', async (request, response, next) => {
    try { const project = await archive.getProject(projectNumber(request)); if (!project) return response.status(404).json({ code: 'NOT_FOUND', message: 'Project is not archived yet.' }); response.json(project); } catch (error) { next(error); }
  });
  app.get('/api/archive/projects/:projectNumber/documents', async (request, response, next) => {
    try { const number = projectNumber(request); const project = await archive.getProject(number); if (!project) return response.status(404).json({ code: 'NOT_FOUND', message: 'Project is not archived yet.' }); response.json({ documents: await archive.getDocuments(number) }); } catch (error) { next(error); }
  });
  app.get('/api/archive/documents/:documentId/download', async (request, response, next) => {
    try {
      const document = await archive.getDocument(documentIdSchema.parse(request.params.documentId));
      if (!document) return response.status(404).json({ code: 'NOT_FOUND', message: 'Archived document not found.' });
      if (!document.downloadable || document.downloadStatus !== 'downloaded' || !document.storageKey) return response.status(409).json({ code: 'NOT_DOWNLOADABLE', message: 'This document was not archived for download.' });
      response.redirect(302, await objectStore.signedDownloadUrl(document.storageKey, document.filename));
    } catch (error) { next(error); }
  });
  app.get('/api/archive/status', async (_request, response, next) => { try { response.json(await archive.stats()); } catch (error) { next(error); } });
  app.use('/api', (_request, response) => response.status(404).json({ code: 'NOT_FOUND', message: 'API route not found.' }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof InputError || error instanceof z.ZodError) return response.status(400).json({ code: 'INVALID_INPUT', message: error instanceof InputError ? error.message : 'Invalid request.' });
    logger.error({ err: error }, 'unhandled API error');
    return response.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' });
  });
  return app;
}

function projectNumber(request: Request): string { const value = request.params.projectNumber; if (typeof value !== 'string') throw new InputError('Invalid project number.'); return parseProjectInput(value); }
