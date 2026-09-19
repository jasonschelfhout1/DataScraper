import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { HttpOmgevingsloketProvider } from './http-provider.js';

const projectId = '78Jiio5hTkScAWF-m1ikZg';
const phaseId = 'CVVCIlCqTAq_cfYodAu6fA';
const eventId = '1CRvyT15SQaSnTSl_kCaIw';
const fileId = 'DB0GKx5YRlSRfPBg8YY_QA';

function jsonFor(path: string): unknown {
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
});
