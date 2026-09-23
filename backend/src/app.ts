import type { Express, NextFunction, Request, Response } from 'express';
import archiver from 'archiver';
import express from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { configureSession, login, logout, requireAuthentication, sessionStatus } from './auth.js';
import type { ArchiveDocument, ArchiveProject, ArchiveRepository } from './archive/types.js';
import { config } from './config.js';
import { InputError, parseProjectInput } from './validation.js';
import { expensiveRequestLimiter, loginAttemptLimiter } from './rate-limit.js';
import { sanitizeFilename, uniqueFilenames } from './filenames.js';
import type { ObjectStore } from './storage/object-store.js';
import { LiveFallback } from './omgevingsloket/live-fallback.js';
import { UpstreamError } from './omgevingsloket/errors.js';
import type { Document, DownloadStream, Project } from './omgevingsloket/types.js';

const searchSchema = z.object({ q: z.string().max(200).default(''), municipality: z.string().max(200).default(''), status: z.string().max(200).default(''), publicationType: z.string().max(200).default(''), visibility: z.enum(['all', 'current', 'historical']).default('all'), page: z.coerce.number().int().min(0).default(0), size: z.coerce.number().int().min(1).max(100).default(25) });
const bulkDownloadSchema = z.object({ documentId: z.union([z.string().uuid(), z.array(z.string().uuid()).max(config.MAX_DOCUMENTS_PER_DOWNLOAD)]).optional() });
const liveProjectSchema = z.object({ input: z.string().max(500) });
const documentIdSchema = z.string().uuid();

/** Archive API with an explicit, rate-limited user-requested live fallback. */
export function createApp(archive: ArchiveRepository, objectStore: ObjectStore, logger: Logger, live?: LiveFallback): Express {
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

  app.get('/api/live/projects', expensiveRequestLimiter(config), async (request, response, next) => {
    try {
      const project = await requireLive(live).getProject(parseProjectInput(liveProjectSchema.parse(request.query).input));
      response.json(liveProject(project));
    } catch (error) { next(error); }
  });
  app.get('/api/live/projects/:projectNumber/documents', expensiveRequestLimiter(config), async (request, response, next) => {
    try { const number = projectNumber(request); response.json({ documents: (await requireLive(live).getDocuments(number)).map(liveDocument) }); } catch (error) { next(error); }
  });
  app.get('/api/live/projects/:projectNumber/download', expensiveRequestLimiter(config), async (request, response, next) => {
    try {
      const number = projectNumber(request); const fallback = requireLive(live);
      const requestedIds = parseBulkDocumentIds(request.query);
      const tokens = requestedIds.length ? requestedIds : (await fallback.getDocuments(number)).filter((document) => document.downloadable).map((document) => document.token);
      if (!tokens.length) return response.status(409).json({ code: 'NO_ARCHIVED_DOCUMENTS', message: 'This project has no publicly downloadable documents.' });
      if (tokens.length > config.MAX_DOCUMENTS_PER_DOWNLOAD) return response.status(413).json({ code: 'DOWNLOAD_LIMIT', message: `This project has more than ${config.MAX_DOCUMENTS_PER_DOWNLOAD} downloadable documents. Download files individually.` });
      const documents = await fallback.resolveTokens(number, tokens);
      streamZip(response, `omgevingsloket-${number}.zip`, documents.map((document) => document.name), async (index) => (await fallback.downloadResolvedDocument(number, documents[index]!)).stream);
    } catch (error) { next(error); }
  });
  app.get('/api/live/documents/:documentId/download', expensiveRequestLimiter(config), async (request, response, next) => {
    try {
      const token = documentIdSchema.parse(request.params.documentId);
      const number = z.string().regex(/^\d{10}$/).parse(request.query.projectNumber);
      streamLiveDocument(response, await requireLive(live).downloadToken(number, token));
    } catch (error) { next(error); }
  });

  app.get('/api/archive/projects', async (request, response, next) => {
    try { const query = searchSchema.parse(request.query); response.json(await archive.searchProjects({ query: query.q, municipality: query.municipality || undefined, status: query.status || undefined, publicationType: query.publicationType || undefined, visibility: query.visibility }, query.page, query.size)); } catch (error) { next(error); }
  });
  app.get('/api/archive/filters', async (_request, response, next) => { try { response.json(await archive.filters()); } catch (error) { next(error); } });
  app.get('/api/archive/download', async (_request, response, next) => {
    try {
      const documents = await archive.getAllStoredDocuments();
      if (!documents.length) return response.status(409).json({ code: 'NO_ARCHIVED_DOCUMENTS', message: 'There are no downloadable files in the archive bucket.' });
      streamZip(response, 'omgevingsloket-archive.zip', documents.map((document) => `${document.projectNumber}-${document.filename}`), async (index) => objectStore.get(documents[index]!.storageKey!));
    } catch (error) { next(error); }
  });
  app.get('/api/archive/projects/:projectNumber', async (request, response, next) => {
    try { const project = await archive.getProject(projectNumber(request)); if (!project) return response.status(404).json({ code: 'NOT_FOUND', message: 'Project is not archived yet.' }); response.json(project); } catch (error) { next(error); }
  });
  app.get('/api/archive/projects/:projectNumber/documents', async (request, response, next) => {
    try { const number = projectNumber(request); const project = await archive.getProject(number); if (!project) return response.status(404).json({ code: 'NOT_FOUND', message: 'Project is not archived yet.' }); response.json({ documents: await archive.getDocuments(number) }); } catch (error) { next(error); }
  });
  app.get('/api/archive/projects/:projectNumber/download', async (request, response, next) => {
    try {
      const number = projectNumber(request);
      const project = await archive.getProject(number);
      if (!project) return response.status(404).json({ code: 'NOT_FOUND', message: 'Project is not archived yet.' });
      const requestedIds = parseBulkDocumentIds(request.query);
      const storedDocuments = (await archive.getDocuments(number)).filter((document) => document.downloadable && document.downloadStatus === 'downloaded' && document.storageKey);
      const selected = requestedIds.length ? storedDocuments.filter((document) => requestedIds.includes(document.id)) : storedDocuments;
      if (requestedIds.length && selected.length !== requestedIds.length) return response.status(409).json({ code: 'NOT_DOWNLOADABLE', message: 'One or more selected documents are not stored in the archive bucket.' });
      const documents: ArchiveDocument[] = [];
      for (const document of selected) if (await objectStore.exists(document.storageKey!)) documents.push(document);
      if (requestedIds.length && documents.length !== requestedIds.length) return response.status(409).json({ code: 'NOT_DOWNLOADABLE', message: 'One or more selected documents are no longer present in the archive bucket.' });
      if (!documents.length) return response.status(409).json({ code: 'NO_ARCHIVED_DOCUMENTS', message: 'This project has no downloadable files in the archive bucket.' });
      if (documents.length > config.MAX_DOCUMENTS_PER_DOWNLOAD) return response.status(413).json({ code: 'DOWNLOAD_LIMIT', message: `This project has more than ${config.MAX_DOCUMENTS_PER_DOWNLOAD} archived documents. Download files individually.` });
      streamZip(response, `omgevingsloket-${number}.zip`, documents.map((document) => document.filename), async (index) => objectStore.get(documents[index]!.storageKey!));
    } catch (error) { next(error); }
  });
  app.get('/api/archive/documents/:documentId/download', async (request, response, next) => {
    try {
      const document = await archive.getDocument(documentIdSchema.parse(request.params.documentId));
      if (!document) return response.status(404).json({ code: 'NOT_FOUND', message: 'Archived document not found.' });
      if (!document.downloadable) return response.status(409).json({ code: 'NOT_DOWNLOADABLE', message: 'This document is not publicly downloadable.' });
      if (document.downloadStatus === 'downloaded' && document.storageKey && await objectStore.exists(document.storageKey)) return response.redirect(302, await objectStore.signedDownloadUrl(document.storageKey, document.filename));
      streamLiveDocument(response, await requireLive(live).downloadUpstreamDocument(document.projectNumber, document.upstreamUuid));
    } catch (error) { next(error); }
  });
  app.get('/api/archive/status', async (_request, response, next) => { try { response.json(await archive.stats()); } catch (error) { next(error); } });
  app.use('/api', (_request, response) => response.status(404).json({ code: 'NOT_FOUND', message: 'API route not found.' }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return response.destroy(error instanceof Error ? error : undefined);
    if (error instanceof InputError || error instanceof z.ZodError) return response.status(400).json({ code: 'INVALID_INPUT', message: error instanceof InputError ? error.message : 'Invalid request.' });
    if (error instanceof UpstreamError) return response.status(upstreamStatus(error)).json({ code: error.kind.toUpperCase(), message: error.message });
    logger.error({ err: error }, 'unhandled API error');
    return response.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' });
  });
  return app;
}

function projectNumber(request: Request): string { const value = request.params.projectNumber; if (typeof value !== 'string') throw new InputError('Invalid project number.'); return parseProjectInput(value); }
function parseBulkDocumentIds(query: Request['query']): string[] {
  const parsed = bulkDownloadSchema.parse(query).documentId;
  return parsed === undefined ? [] : Array.isArray(parsed) ? [...new Set(parsed)] : [parsed];
}
function requireLive(live: LiveFallback | undefined): LiveFallback { if (!live) throw new UpstreamError('Live fallback is not configured for this service.', 'temporary'); return live; }
function liveProject(project: Project): ArchiveProject { const now = new Date().toISOString(); return { id: `live-${project.projectNumber}`, projectNumber: project.projectNumber, ...(project.title ? { title: project.title } : {}), ...(project.municipality ? { municipality: project.municipality } : {}), ...(project.status ? { status: project.status } : {}), source: 'live', isCurrentlyPublic: true, firstSeenAt: now, lastSeenAt: now }; }
function liveDocument(document: Document & { token: string }): ArchiveDocument { return { id: document.token, projectNumber: document.projectNumber, upstreamUuid: '', filename: document.name, ...(document.description ? { description: document.description } : {}), ...(document.category ? { category: document.category } : {}), ...(document.mimeType ? { mimeType: document.mimeType } : {}), ...(document.size !== undefined ? { sizeBytes: document.size } : {}), ...(document.viewerUrl ? { viewerUrl: document.viewerUrl } : {}), source: 'live', downloadable: document.downloadable, downloadStatus: document.downloadable ? 'live' : 'view_only', firstSeenAt: new Date().toISOString() }; }
function streamLiveDocument(response: Response, file: DownloadStream): void { response.status(200).setHeader('content-type', file.contentType ?? 'application/octet-stream'); response.setHeader('content-disposition', `attachment; filename="${sanitizeFilename(file.filename)}"`); if (file.contentLength !== undefined) response.setHeader('content-length', String(file.contentLength)); file.stream.on('error', (error) => response.destroy(error)); file.stream.pipe(response); }
function streamZip(response: Response, filename: string, names: string[], streamAt: (index: number) => Promise<import('node:stream').Readable>): void { response.status(200).setHeader('content-type', 'application/zip'); response.setHeader('content-disposition', `attachment; filename="${sanitizeFilename(filename)}"`); response.setHeader('cache-control', 'no-store'); const zip = archiver('zip', { zlib: { level: 6 } }); zip.on('error', (error: Error) => response.destroy(error)); zip.pipe(response); const uniqueNames = uniqueFilenames(names); void (async () => { for (const [index, name] of uniqueNames.entries()) zip.append(await streamAt(index), { name }); await zip.finalize(); })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined)); }
function upstreamStatus(error: UpstreamError): number { if (error.kind === 'not_found') return 404; if (error.kind === 'verification_required') return 424; if (error.kind === 'rate_limited') return 429; return 503; }
