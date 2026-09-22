import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { HttpOmgevingsloketProvider } from './http-provider.js';

const projectId = '78Jiio5hTkScAWF-m1ikZg';
const phaseId = 'CVVCIlCqTAq_cfYodAu6fA';
const eventId = '1CRvyT15SQaSnTSl_kCaIw';
const fileId = 'DB0GKx5YRlSRfPBg8YY_QA';

function jsonFor(path: string): unknown {
  if (path.includes('/projecten/zoeken?')) return {
    content: [{ uuid: projectId, puuid: 'rOvddWgUS-mE_xmONUa3MA', projectnummer: '2018110330', projectNaam: 'Example dossier', behandelendeOverheid: 'Sint-Niklaas', adres: 'Example street 1', inzageGegevensTypeEnum: 'BESLISSING' }],
    number: 0, totalPages: 2, last: false,
  };
  if (path.includes('/header?')) return { uuid: projectId, projectnummer: '2018110330', projectnaam: 'Example dossier', toestand: 'Public' };
  if (path.endsWith('/project-overzicht')) return { bevoegdeOverheid: 'Sint-Niklaas', beslissing: { beslissing: 'Toegestaan' } };
  if (path.endsWith('/procedure')) return [{ uuid: phaseId }];
  if (path.includes('beslissing-gebeurtenissen')) return { content: [], totalPages: 0 };
  if (path.includes('openbare-onderzoeken')) return [{ organisator: 'Example', gebeurtenis: [{ uuid: eventId, gebeurtenis: { code: 'STARTEN_OPENBAAR_ONDERZOEK' } }] }];
  if (path.includes('advies-gebeurtenissen')) return { content: [{ adviesVraagGebeurtenisUuid: 'Q6W4M-gBRRGQgZS0UiADCg' }], totalPages: 1 };
  if (path.includes('andere-gebeurtenissen')) return { content: [], totalPages: 0 };
  if (path.endsWith('/gebeurtenissen/Q6W4M-gBRRGQgZS0UiADCg')) return [{ bestanden: [] }];
  if (path.endsWith(`/gebeurtenissen/${eventId}`)) return [{ bestanden: [{ uuid: fileId, bestandsnaam: 'plan.pdf', omschrijving: 'Plan', mimeType: 'application/pdf', grootte: '82 KB', veiligheidscategorie: 'PUBLIEK_DOWNLOAD' }] }];
  throw new Error(`Unexpected URL: ${path}`);
}

describe('HttpOmgevingsloketProvider', () => {
  const provider = new HttpOmgevingsloketProvider({
    expectJson: async (url) => jsonFor(url.toString()),
    fetch: async () => new Response(Readable.toWeb(Readable.from('pdf')), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="plan.pdf"', 'content-length': '3' } }),
  });

  it('normalizes the confirmed project endpoints', async () => {
    await expect(provider.getProject('2018110330')).resolves.toMatchObject({ projectNumber: '2018110330', title: 'Example dossier', municipality: 'Sint-Niklaas' });
  });
  it('uses the captured map-search POST contract without inventing filters', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const searchProvider = new HttpOmgevingsloketProvider({
      expectJson: async (url, init) => { calls.push({ url: url.toString(), init }); return jsonFor(url.toString()); },
      fetch: async () => new Response(),
    });
    await expect(searchProvider.searchProjects({ minX: 99_138, minY: 181_025, maxX: 129_337, maxY: 203_330 }, 0)).resolves.toEqual({
      page: 0, totalPages: 2, last: false,
      projects: [expect.objectContaining({ projectNumber: '2018110330', upstreamUuid: projectId, publicationType: 'BESLISSING' })],
    });
    expect(calls[0].url).toContain('/projecten/zoeken?page=0&size=10&sort=PROJECTNUMMER');
    expect(calls[0].init).toMatchObject({ method: 'POST' });
    expect(String(calls[0].init?.body)).toContain('InzageFilterinhoudMetBoundingBox');
  });
  it('follows phase, event, and public-file relationships', async () => {
    await expect(provider.getDocuments('2018110330')).resolves.toEqual([expect.objectContaining({ id: fileId, name: 'plan.pdf', size: 82 * 1024, downloadable: true })]);
  });
  it('uses only the confirmed file-download endpoint', async () => {
    const file = await provider.downloadDocument('2018110330', fileId);
    expect(file.filename).toBe('plan.pdf');
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('pdf');
  });
  it('provides a reauthorization error for a rejected download session', async () => {
    const rejected = new HttpOmgevingsloketProvider({
      expectJson: async () => ({}),
      fetch: async () => new Response(null, { status: 403 }),
    });
    await expect(rejected.downloadDocument('2018110330', fileId)).rejects.toMatchObject({ kind: 'verification_required' });
  });
});
