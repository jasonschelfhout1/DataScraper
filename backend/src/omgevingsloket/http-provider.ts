import { Readable } from 'node:stream';
import { z } from 'zod';
import { config } from '../config.js';
import { OmgevingsloketHttpClient } from './client.js';
import { UpstreamError } from './errors.js';
import type { DiscoveredProject, Document, DownloadStream, OmgevingsloketProvider, Project, ProjectSearchPage, SearchBounds } from './types.js';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{10,128}$/);
const headerSchema = z.object({ uuid: idSchema, projectnummer: z.string(), projectnaam: z.string().optional(), toestand: z.string().optional() }).passthrough();
const overviewSchema = z.object({ bevoegdeOverheid: z.string().optional(), beslissing: z.object({ beslissing: z.string().optional() }).nullable().optional() }).passthrough();
const phaseSchema = z.object({ uuid: idSchema }).passthrough();
const eventSchema = z.object({ uuid: idSchema.optional(), adviesVraagGebeurtenisUuid: idSchema.optional(), gebeurtenis: z.object({ code: z.string().optional() }).optional() })
  .passthrough()
  .refine((event) => event.uuid !== undefined || event.adviesVraagGebeurtenisUuid !== undefined, 'Missing event identifier');
const pageSchema = z.object({ content: z.array(z.unknown()), totalPages: z.number().int().nonnegative().optional(), last: z.boolean().optional(), number: z.number().int().nonnegative().optional() }).passthrough();
const searchProjectSchema = z.object({
  uuid: idSchema,
  puuid: idSchema.optional(),
  projectnummer: z.string().regex(/^\d{10}$/),
  projectNaam: z.string().optional(),
  behandelendeOverheid: z.string().optional(),
  adres: z.string().optional(),
  inzageGegevensTypeEnum: z.string().optional(),
}).passthrough();
const fileSchema = z.object({
  uuid: idSchema, bestandsnaam: z.string().min(1), omschrijving: z.string().nullable().optional(), mimeType: z.string().nullable().optional(),
  grootte: z.string().nullable().optional(), veiligheidscategorie: z.string().nullable().optional(),
}).passthrough();
const eventDetailSchema = z.object({ bestanden: z.array(fileSchema).optional() }).passthrough();

type HttpClient = Pick<OmgevingsloketHttpClient, 'expectJson' | 'fetch'>;
const API_PREFIX = '/proxy-omv-up/rs/v1/inzage';
const eventCollections = [
  { suffix: 'openbare-onderzoeken', category: 'Openbare onderzoeken', paged: false },
  { suffix: 'advies-gebeurtenissen', category: 'Adviezen', paged: true },
  { suffix: 'beslissing-gebeurtenissen', category: 'Beslissingen', paged: true },
  { suffix: 'andere-gebeurtenissen', category: 'Andere gebeurtenissen', paged: true },
] as const;

/** Confirmed from the user-authorized 2018110330 capture. */
export class HttpOmgevingsloketProvider implements OmgevingsloketProvider {
  constructor(private readonly client: HttpClient = new OmgevingsloketHttpClient()) {}

  async searchProjects(bounds: SearchBounds, page: number): Promise<ProjectSearchPage> {
    if (!Number.isInteger(page) || page < 0 || !validBounds(bounds)) throw new UpstreamError('The requested discovery bounds are invalid.', 'unexpected');
    try {
      // Captured from the official map UI: POST body is a one-item bounding-box filter array;
      // page size and sort intentionally match the observed request exactly.
      const result = pageSchema.parse(await this.client.expectJson(
        this.url(`/projecten/zoeken?page=${page}&size=10&sort=PROJECTNUMMER`),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([boundingBoxFilter(bounds)]) },
      ));
      const projects = result.content.map((item): DiscoveredProject => {
        const project = searchProjectSchema.parse(item);
        return {
          projectNumber: project.projectnummer,
          upstreamUuid: project.uuid,
          ...(project.puuid ? { upstreamPuuid: project.puuid } : {}),
          ...(project.projectNaam ? { title: project.projectNaam } : {}),
          ...(project.behandelendeOverheid ? { municipality: project.behandelendeOverheid } : {}),
          ...(project.adres ? { address: project.adres } : {}),
          ...(project.inzageGegevensTypeEnum ? { publicationType: project.inzageGegevensTypeEnum } : {}),
        };
      });
      const totalPages = result.totalPages ?? (result.last ? page + 1 : page + 1);
      return { projects, page: result.number ?? page, totalPages, last: result.last ?? page + 1 >= totalPages };
    } catch (error) {
      throw normalizeSchemaError(error);
    }
  }

  async getProject(projectNumber: string): Promise<Project> {
    try {
      const header = headerSchema.parse(await this.json(`/projecten/header?projectnummer=${encodeURIComponent(projectNumber)}`));
      const overview = overviewSchema.parse(await this.json(`/projecten/${header.uuid}/project-overzicht`));
      return {
        projectNumber: header.projectnummer,
        ...(header.projectnaam ? { title: header.projectnaam } : {}),
        ...(header.toestand ? { status: header.toestand } : {}),
        ...(overview.bevoegdeOverheid ? { municipality: overview.bevoegdeOverheid } : {}),
        ...(overview.beslissing?.beslissing ? { description: overview.beslissing.beslissing } : {}),
      };
    } catch (error) {
      throw normalizeSchemaError(error);
    }
  }

  async getDocuments(projectNumber: string): Promise<Document[]> {
    try {
      const header = headerSchema.parse(await this.json(`/projecten/header?projectnummer=${encodeURIComponent(projectNumber)}`));
      const procedure = z.array(phaseSchema).parse(await this.json(`/projecten/${header.uuid}/procedure`));
      const discovered: Document[][] = [];
      for (const phase of procedure) discovered.push(await this.documentsForPhase(projectNumber, phase.uuid));
      const unique = new Map<string, Document>();
      discovered.flat().forEach((document) => unique.set(document.id, document));
      return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, 'nl'));
    } catch (error) {
      throw normalizeSchemaError(error);
    }
  }

  async downloadDocument(_projectNumber: string, documentId: string): Promise<DownloadStream> {
    const response = await this.client.fetch(this.url(`/bestanden/${documentId}/download`));
    if (response.status === 401 || response.status === 403) {
      throw new UpstreamError('Official browser verification is required. Run npm run authorize and try again.', 'verification_required', response.status);
    }
    if (!response.ok || !response.body) {
      throw new UpstreamError('The upstream service could not provide this document.', response.status === 404 ? 'not_found' : 'unexpected', response.status);
    }
    const contentType = response.headers.get('content-type') ?? undefined;
    if (contentType?.includes('text/html')) {
      throw new UpstreamError('Official browser verification is required. Run npm run authorize and try again.', 'verification_required', response.status);
    }
    return {
      stream: Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
      filename: filenameFromDisposition(response.headers.get('content-disposition')) ?? `${documentId}.bin`,
      contentType,
      ...(response.headers.get('content-length') ? { contentLength: Number(response.headers.get('content-length')) } : {}),
    };
  }

  private async documentsForPhase(projectNumber: string, phaseId: string): Promise<Document[]> {
    const events: Array<{ category: string; eventId: string }> = [];
    for (const collection of eventCollections) {
      const found = await this.eventsForCollection(phaseId, collection.suffix, collection.paged);
      events.push(...found.map((eventId) => ({ category: collection.category, eventId })));
    }
    const details: Array<{ category: string; eventId: string; details: z.infer<typeof eventDetailSchema>[] }> = [];
    for (const { category, eventId } of events) details.push({ category, eventId, details: z.array(eventDetailSchema).parse(await this.json(`/gebeurtenissen/${eventId}`)) });
    return details.flatMap(({ category, eventId, details: eventDetails }) => eventDetails.flatMap((detail) =>
      (detail.bestanden ?? []).map((file) => ({
        id: file.uuid,
        projectNumber,
        name: file.bestandsnaam,
        ...(file.omschrijving ? { description: file.omschrijving } : {}),
        category,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        ...(parseSize(file.grootte) !== undefined ? { size: parseSize(file.grootte) } : {}),
        viewerUrl: new URL(`/${projectNumber}/${phaseId}/${eventId}`, config.baseUrl).toString(),
        downloadable: file.veiligheidscategorie === 'PUBLIEK_DOWNLOAD',
      })),
    ));
  }

  private async eventsForCollection(phaseId: string, suffix: string, paged: boolean): Promise<string[]> {
    const path = `/projectfasen/${phaseId}/${suffix}`;
    const first = await this.json(paged ? `${path}?page=0&size=100&sort=id` : path);
    if (Array.isArray(first)) return extractEventIds(first);
    const page = pageSchema.parse(first);
    if (!paged || page.totalPages === undefined || page.totalPages <= 1) return extractEventIds(page.content);
    const ids = extractEventIds(page.content);
    for (let index = 1; index < page.totalPages; index += 1) ids.push(...extractEventIds(pageSchema.parse(await this.json(`${path}?page=${index}&size=100&sort=id`)).content));
    return ids;
  }

  private json(path: string): Promise<unknown> {
    return this.client.expectJson(this.url(path));
  }

  private url(path: string): URL {
    return new URL(`${API_PREFIX}${path}`, config.baseUrl);
  }
}

function boundingBoxFilter(bounds: SearchBounds) {
  return {
    filterType: 'BOUNDING_BOX',
    abstractFilterInhoud: {
      '@type': 'InzageFilterinhoudMetBoundingBox',
      boundingBoxResource: bounds,
      coordinatenStelsel: 'EPSG:31370',
    },
  };
}

function validBounds(bounds: SearchBounds): boolean {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
    && bounds.minX < bounds.maxX && bounds.minY < bounds.maxY;
}

function parseSize(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+(?:[.,]\d+)?)\s*(B|KB|MB|GB)$/i.exec(value.trim());
  if (!match) return undefined;
  const unit = match[2].toUpperCase();
  const multiplier = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : unit === 'KB' ? 1024 : 1;
  return Math.round(Number(match[1].replace(',', '.')) * multiplier);
}

function filenameFromDisposition(value: string | null): string | undefined {
  const match = /filename="?([^";]+)"?/i.exec(value ?? '');
  return match?.[1];
}

function extractEventIds(items: unknown[]): string[] {
  return items.flatMap((item) => {
    const publicInvestigation = z.object({ gebeurtenis: z.array(eventSchema) }).passthrough().safeParse(item);
    if (publicInvestigation.success) return publicInvestigation.data.gebeurtenis.map(eventId);
    return [eventId(eventSchema.parse(item))];
  });
}

function eventId(event: z.infer<typeof eventSchema>): string {
  return event.uuid ?? event.adviesVraagGebeurtenisUuid!;
}

function normalizeSchemaError(error: unknown): Error {
  if (error instanceof z.ZodError) return new UpstreamError('The upstream service returned an unexpected response.', 'unexpected');
  return error instanceof Error ? error : new UpstreamError('The upstream service returned an unexpected response.', 'unexpected');
}
