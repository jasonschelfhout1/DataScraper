import { Readable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { OmgevingsloketProvider } from './omgevingsloket/types.js';

const document = { id: 'document_one', projectNumber: '2026045710', name: 'plan.pdf', downloadable: true };
let upstreamCalls = 0;
const provider: OmgevingsloketProvider = {
  getProject: async (projectNumber) => { upstreamCalls += 1; return { projectNumber, title: 'Example project' }; },
  getDocuments: async () => { upstreamCalls += 1; return [document]; },
  downloadDocument: async () => { upstreamCalls += 1; return { stream: Readable.from('file'), filename: 'plan.pdf', contentType: 'application/pdf' }; },
};

function app() {
  return createApp(provider, pino({ enabled: false }));
}

function signIn(agent: ReturnType<typeof request.agent>) {
  return agent.post('/api/auth/login').send({ username: 'test-user', password: 'test-password' });
}

describe('authentication and internal API', () => {
  it('provides a public health check without calling upstream', async () => {
    const callsBefore = upstreamCalls;
    const response = await request(app()).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(upstreamCalls).toBe(callsBefore);
  });

  it('protects project and download-job routes from unauthenticated access', async () => {
    const unauthenticated = request(app());
    await unauthenticated.get('/api/projects/2026045710').expect(401, { code: 'UNAUTHORIZED', message: 'Authentication required.' });
    await unauthenticated.get('/api/downloads/00000000-0000-4000-8000-000000000000').expect(401, { code: 'UNAUTHORIZED', message: 'Authentication required.' });
  });

  it('rejects invalid credentials without returning secrets', async () => {
    const response = await request(app()).post('/api/auth/login').send({ username: 'test-user', password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
    expect(JSON.stringify(response.body)).not.toContain('test-password');
  });

  it('creates a signed HTTP-only session and permits authenticated project access', async () => {
    const agent = request.agent(app());
    const login = await signIn(agent);
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ authenticated: true, username: 'test-user' });
    expect(login.headers['set-cookie']?.join(';')).toContain('httponly');
    expect(login.headers['set-cookie']?.join(';')).toContain('samesite=strict');
    expect(login.headers['set-cookie']?.join(';')).toContain('expires=');
    expect(login.headers['set-cookie']?.join(';')).toContain('datascraper_session.sig=');
    await agent.get('/api/projects/2026045710').expect(200).expect(({ body }) => expect(body.projectNumber).toBe('2026045710'));
  });

  it('reports session state and logout immediately clears it', async () => {
    const agent = request.agent(app());
    await signIn(agent).expect(200);
    await agent.get('/api/auth/session').expect(200, { authenticated: true, username: 'test-user' });
    await agent.post('/api/auth/logout').expect(200, { authenticated: false });
    await agent.get('/api/auth/session').expect(200, { authenticated: false });
    await agent.get('/api/projects/2026045710').expect(401);
  });

  it('limits repeated login attempts and supplies Retry-After', async () => {
    const candidate = request(app());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await candidate.post('/api/auth/login').send({ username: 'test-user', password: 'wrong-password' }).expect(401);
    }
    const limited = await candidate.post('/api/auth/login').send({ username: 'test-user', password: 'wrong-password' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('retains the project rate limiter after authentication', async () => {
    const agent = request.agent(app());
    await signIn(agent).expect(200);
    for (let attempt = 0; attempt < 30; attempt += 1) await agent.get('/api/projects/2026045710').expect(200);
    await agent.get('/api/projects/2026045710').expect(429);
  });

  it('continues to stream known documents and create ZIP jobs for an authenticated user', async () => {
    const agent = request.agent(app());
    await signIn(agent).expect(200);
    await agent.get('/api/projects/2026045710/documents/document_one/download').expect(200).expect('content-type', /application\/pdf/);
    const start = await agent.post('/api/projects/2026045710/downloads').send({ documentIds: ['document_one'] }).expect(202);
    let report = await agent.get(`/api/downloads/${start.body.id}`);
    for (let tries = 0; tries < 20 && report.body.status === 'running'; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      report = await agent.get(`/api/downloads/${start.body.id}`);
    }
    expect(report.body.status).toBe('completed');
    expect(report.body.downloadUrl).toContain('/file');
  });
});
