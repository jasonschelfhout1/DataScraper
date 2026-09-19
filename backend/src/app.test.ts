import { Readable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { OmgevingsloketProvider } from './omgevingsloket/types.js';

const document = { id: 'document_one', projectNumber: '2026045710', name: 'plan.pdf', downloadable: true };
const provider: OmgevingsloketProvider = {
  getProject: async (projectNumber) => ({ projectNumber, title: 'Example project' }),
  getDocuments: async () => [document],
  downloadDocument: async () => ({ stream: Readable.from('file'), filename: 'plan.pdf', contentType: 'application/pdf' }),
};
const app = createApp(provider, pino({ enabled: false }));

describe('internal API', () => {
  it('rejects invalid project input', async () => {
    const response = await request(app).get('/api/projects/not-a-project');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
  });
  it('does not expose an arbitrary proxy endpoint', async () => {
    const response = await request(app).get('/api/proxy?url=https://example.com');
    expect(response.status).toBe(404);
  });
  it('streams only a known project document', async () => {
    const response = await request(app).get('/api/projects/2026045710/documents/document_one/download');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
  });
  it('creates a ZIP job only from known listed documents', async () => {
    const start = await request(app).post('/api/projects/2026045710/downloads').send({ documentIds: ['document_one'] });
    expect(start.status).toBe(202);
    let report = await request(app).get(`/api/downloads/${start.body.id}`);
    for (let tries = 0; tries < 20 && report.body.status === 'running'; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      report = await request(app).get(`/api/downloads/${start.body.id}`);
    }
    expect(report.body.status).toBe('completed');
    expect(report.body.downloadUrl).toContain('/file');
  });
});
