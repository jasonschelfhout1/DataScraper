import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { ArchiveDocument, ArchiveProject, ArchiveRepository, ArchiveStats } from './archive/types.js';
import { MemoryObjectStore } from './storage/object-store.js';

const project: ArchiveProject = { id: '11111111-1111-4111-8111-111111111111', projectNumber: '2026045710', title: 'Archive example', municipality: 'Gent', isCurrentlyPublic: true, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), documentCount: 2 };
const archived: ArchiveDocument = { id: '22222222-2222-4222-8222-222222222222', projectNumber: project.projectNumber, upstreamUuid: 'document_one', filename: 'plan.pdf', downloadable: true, downloadStatus: 'downloaded', storageKey: 'projects/2026045710/document_one/plan.pdf', firstSeenAt: new Date().toISOString() };
const viewOnly: ArchiveDocument = { id: '33333333-3333-4333-8333-333333333333', projectNumber: project.projectNumber, upstreamUuid: 'document_two', filename: 'copyright.pdf', downloadable: false, downloadStatus: 'view_only', firstSeenAt: new Date().toISOString() };
const stats: ArchiveStats = { projects: 1, currentlyPublicProjects: 1, documents: 2, archivedDocuments: 1, viewOnlyDocuments: 1, pendingDownloads: 0, failedDownloads: 0, pendingTasks: 0, paused: false };
const archive: ArchiveRepository = { searchProjects: async () => ({ projects: [project], total: 1 }), getProject: async (number) => number === project.projectNumber ? project : undefined, getDocuments: async () => [archived, viewOnly], getDocument: async (id) => [archived, viewOnly].find((document) => document.id === id), stats: async () => stats };
function app() { return createApp(archive, new MemoryObjectStore(), pino({ enabled: false })); }
function signIn(agent: ReturnType<typeof request.agent>) { return agent.post('/api/auth/login').send({ username: 'test-user', password: 'test-password' }); }

describe('archive API', () => {
  it('keeps health public and protects all archive routes', async () => {
    await request(app()).get('/api/health').expect(200).expect(({ body }) => expect(body.status).toBe('ok'));
    await request(app()).get('/api/archive/projects').expect(401, { code: 'UNAUTHORIZED', message: 'Authentication required.' });
    await request(app()).get(`/api/archive/documents/${archived.id}/download`).expect(401);
  });
  it('creates a signed session and only exposes the configured username', async () => {
    const agent = request.agent(app());
    const login = await signIn(agent).expect(200);
    expect(login.body).toEqual({ authenticated: true, username: 'test-user' });
    expect(login.headers['set-cookie']?.join(';')).toContain('httponly');
    await agent.get('/api/auth/session').expect(200, { authenticated: true, username: 'test-user' });
    await agent.post('/api/auth/logout').expect(200, { authenticated: false });
  });
  it('returns archive search, detail and document metadata without an upstream provider', async () => {
    const agent = request.agent(app()); await signIn(agent).expect(200);
    await agent.get('/api/archive/projects?q=gent').expect(200).expect(({ body }) => expect(body.projects[0].projectNumber).toBe(project.projectNumber));
    await agent.get(`/api/archive/projects/${project.projectNumber}`).expect(200).expect(({ body }) => expect(body.title).toBe('Archive example'));
    await agent.get(`/api/archive/projects/${project.projectNumber}/documents`).expect(200).expect(({ body }) => expect(body.documents).toHaveLength(2));
    await agent.get('/api/archive/status').expect(200).expect(({ body }) => expect(body.archivedDocuments).toBe(1));
  });
  it('never offers an R2 download for view-only documents', async () => {
    const agent = request.agent(app()); await signIn(agent).expect(200);
    await agent.get(`/api/archive/documents/${viewOnly.id}/download`).expect(409, { code: 'NOT_DOWNLOADABLE', message: 'This document was not archived for download.' });
  });
  it('rate limits invalid login attempts', async () => {
    const candidate = request(app()); for (let i = 0; i < 5; i += 1) await candidate.post('/api/auth/login').send({ username: 'test-user', password: 'wrong' }).expect(401);
    await candidate.post('/api/auth/login').send({ username: 'test-user', password: 'wrong' }).expect(429);
  });
});
