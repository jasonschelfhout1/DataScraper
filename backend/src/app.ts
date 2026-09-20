import { createReadStream } from 'node:fs';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { configureSession, login, logout, requireAuthentication, sessionStatus } from './auth.js';
import { config } from './config.js';
import { DownloadCapacityError, DownloadJobs } from './downloads.js';
import { sanitizeFilename } from './filenames.js';
import { DiscoveryRequiredError, UpstreamError } from './omgevingsloket/errors.js';
import { TimedCache } from './omgevingsloket/cache.js';
import type { Document, OmgevingsloketProvider, Project } from './omgevingsloket/types.js';
import { documentIdSchema, InputError, parseProjectInput } from './validation.js';
import { expensiveRequestLimiter, loginAttemptLimiter } from './rate-limit.js';

const downloadRequestSchema = z.object({ documentIds: z.array(documentIdSchema).min(1) });
const jobIdSchema = z.string().uuid();

export function createApp(provider: OmgevingsloketProvider, logger: Logger): Express {
  const app = express();
  const projects = new TimedCache<Project>(config.CACHE_TTL_MS);
  const documents = new TimedCache<Document[]>(config.CACHE_TTL_MS);
  const jobs = new DownloadJobs(provider, logger);
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(pinoHttp({
    logger,
    serializers: {
      req: (request) => ({ id: request.id, method: request.method, url: request.url, remoteAddress: request.remoteAddress }),
      res: (response) => ({ statusCode: response.statusCode }),
    },
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use(configureSession());
  app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'datascraper', uptime: Math.floor(process.uptime()) }));
  app.post('/api/auth/login', loginAttemptLimiter(config), login);
  app.post('/api/auth/logout', logout);
  app.get('/api/auth/session', sessionStatus);
  app.use('/api', requireAuthentication);
  app.use('/api/projects', expensiveRequestLimiter(config));

  const projectFor = async (projectNumber: string): Promise<Project> => {
    const cached = projects.get(projectNumber);
    if (cached) return cached;
    logger.info({ projectNumber }, 'project lookup started');
    const project = await provider.getProject(projectNumber);
    projects.set(projectNumber, project);
    logger.info({ projectNumber }, 'project lookup completed');
    return project;
  };
  const documentsFor = async (projectNumber: string): Promise<Document[]> => {
    const cached = documents.get(projectNumber);
    if (cached) return cached;
    const found = await provider.getDocuments(projectNumber);
    documents.set(projectNumber, found);
    logger.info({ projectNumber, documents: found.length }, 'document discovery completed');
    return found;
  };
  const numberFrom = (request: Request): string => {
    const value = request.params.projectNumber;
    if (typeof value !== 'string') throw new InputError('Invalid project number.');
    return parseProjectInput(value);
  };

  app.get('/api/projects/:projectNumber', async (request, response, next) => {
    try { response.json(await projectFor(numberFrom(request))); } catch (error) { next(error); }
  });
  app.get('/api/projects/:projectNumber/documents', async (request, response, next) => {
    try { response.json({ documents: await documentsFor(numberFrom(request)) }); } catch (error) { next(error); }
  });
  app.get('/api/projects/:projectNumber/documents/:documentId/download', async (request, response, next) => {
    try {
      const projectNumber = numberFrom(request);
      const documentId = documentIdSchema.parse(request.params.documentId);
      const document = (await documentsFor(projectNumber)).find((item) => item.id === documentId);
      if (!document) throw new InputError('Document not found for this project.');
      if (!document.downloadable) throw new InputError('This document is view only and cannot be downloaded.');
      const file = await provider.downloadDocument(projectNumber, document.id);
      response.setHeader('content-type', file.contentType ?? 'application/octet-stream');
      response.setHeader('content-disposition', `attachment; filename="${sanitizeFilename(file.filename)}"`);
      if (file.contentLength) response.setHeader('content-length', file.contentLength);
      file.stream.pipe(response);
    } catch (error) { next(error); }
  });
  app.post('/api/projects/:projectNumber/downloads', async (request, response, next) => {
    try {
      const projectNumber = numberFrom(request);
      const body = downloadRequestSchema.parse(request.body);
      if (body.documentIds.length > config.MAX_DOCUMENTS_PER_DOWNLOAD) throw new DownloadLimitError(`Select at most ${config.MAX_DOCUMENTS_PER_DOWNLOAD} documents per archive.`);
      const selected = (await documentsFor(projectNumber)).filter((item) => body.documentIds.includes(item.id) && item.downloadable);
      if (!selected.length) throw new InputError('Select at least one downloadable document.');
      response.status(202).json(jobs.start(projectNumber, selected));
    } catch (error) { next(error); }
  });
  app.get('/api/downloads/:jobId', (request, response, next) => {
    try {
      const job = jobs.get(jobIdSchema.parse(request.params.jobId));
      if (!job) return response.status(404).json({ code: 'NOT_FOUND', message: 'Download job not found or expired.' });
      response.json(job);
    } catch (error) { next(error); }
  });
  app.get('/api/downloads/:jobId/events', (request, response, next) => {
    try {
      if (!jobs.get(jobIdSchema.parse(request.params.jobId))) return response.status(404).json({ code: 'NOT_FOUND', message: 'Download job not found or expired.' });
      response.setHeader('content-type', 'text/event-stream');
      response.setHeader('cache-control', 'no-cache');
      response.setHeader('connection', 'keep-alive');
      response.flushHeaders();
      const unsubscribe = jobs.subscribe(jobIdSchema.parse(request.params.jobId), (report) => response.write(`data: ${JSON.stringify(report)}\n\n`));
      if (!unsubscribe) return response.status(404).json({ code: 'NOT_FOUND', message: 'Download job not found or expired.' });
      request.on('close', unsubscribe);
    } catch (error) { next(error); }
  });
  app.get('/api/downloads/:jobId/file', (request, response, next) => {
    try {
      const jobId = jobIdSchema.parse(request.params.jobId);
      const report = jobs.get(jobId);
      const archivePath = jobs.archivePath(jobId);
      if (!report || !archivePath) return response.status(409).json({ code: 'ARCHIVE_NOT_READY', message: 'The archive is not ready yet.' });
      response.setHeader('content-type', 'application/zip');
      response.setHeader('content-disposition', `attachment; filename="omgevingsloket-${report.projectNumber}.zip"`);
      createReadStream(archivePath).pipe(response);
    } catch (error) { next(error); }
  });
  app.use('/api', (_request, response) => response.status(404).json({ code: 'NOT_FOUND', message: 'API route not found.' }));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof DownloadLimitError || error instanceof DownloadCapacityError) return response.status(429).json({ code: 'DOWNLOAD_LIMIT', message: error.message });
    if (error instanceof InputError || error instanceof z.ZodError) return response.status(400).json({ code: 'INVALID_INPUT', message: error instanceof InputError ? error.message : 'Invalid request.' });
    if (error instanceof DiscoveryRequiredError) return response.status(503).json({ code: 'DISCOVERY_REQUIRED', message: 'Run the authorized discovery workflow before using document retrieval.' });
    if (error instanceof UpstreamError) {
      const status = error.kind === 'not_found' ? 404 : error.kind === 'rate_limited' ? 429 : error.kind === 'verification_required' ? 401 : 502;
      return response.status(status).json({ code: error.kind.toUpperCase(), message: error.message });
    }
    logger.error({ err: error }, 'unhandled API error');
    return response.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' });
  });
  return app;
}

class DownloadLimitError extends Error {}
