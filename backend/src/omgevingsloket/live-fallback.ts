import { randomUUID } from 'node:crypto';
import type { Document, DownloadStream, OmgevingsloketProvider, Project } from './types.js';
import { UpstreamError } from './errors.js';

interface LiveDocumentToken { projectNumber: string; upstreamId: string; expiresAt: number }

/**
 * Short-lived, in-memory access to a user-requested public dossier. Tokens keep
 * upstream identifiers out of browser-controlled download requests. Every
 * download rechecks the official listing before fetching a file.
 */
export class LiveFallback {
  private readonly tokens = new Map<string, LiveDocumentToken>();

  constructor(private readonly provider: OmgevingsloketProvider, private readonly tokenTtlMs: number) {}

  getProject(projectNumber: string): Promise<Project> { return this.provider.getProject(projectNumber); }

  async getDocuments(projectNumber: string): Promise<Array<Document & { token: string }>> {
    const documents = await this.provider.getDocuments(projectNumber);
    this.expireTokens();
    return documents.map((document) => {
      const token = randomUUID();
      this.tokens.set(token, { projectNumber, upstreamId: document.id, expiresAt: Date.now() + this.tokenTtlMs });
      return { ...document, token };
    });
  }

  async downloadToken(projectNumber: string, token: string): Promise<DownloadStream> {
    const [document] = await this.resolveTokens(projectNumber, [token]);
    return this.downloadResolvedDocument(projectNumber, document);
  }

  async resolveTokens(projectNumber: string, tokens: string[]): Promise<Document[]> {
    this.expireTokens();
    const records = tokens.map((token) => this.tokens.get(token));
    if (records.some((record) => !record || record.projectNumber !== projectNumber)) throw new UpstreamError('This live document link has expired. Open the project again and retry.', 'not_found');
    const currentlyListed = await this.provider.getDocuments(projectNumber);
    return records.map((record) => {
      const document = currentlyListed.find((candidate) => candidate.id === record!.upstreamId);
      if (!document || !document.downloadable) throw new UpstreamError('This document is not currently available for public download.', 'not_found');
      return document;
    });
  }

  async downloadUpstreamDocument(projectNumber: string, upstreamId: string): Promise<DownloadStream> {
    const [document] = await this.resolveUpstreamDocuments(projectNumber, [upstreamId]);
    return this.downloadResolvedDocument(projectNumber, document);
  }

  async resolveUpstreamDocuments(projectNumber: string, upstreamIds: string[]): Promise<Document[]> {
    const currentlyListed = await this.provider.getDocuments(projectNumber);
    return upstreamIds.map((upstreamId) => {
      const document = currentlyListed.find((candidate) => candidate.id === upstreamId);
      if (!document || !document.downloadable) throw new UpstreamError('This document is not currently available for public download.', 'not_found');
      return document;
    });
  }

  downloadResolvedDocument(projectNumber: string, document: Document): Promise<DownloadStream> {
    return this.provider.downloadDocument(projectNumber, document.id);
  }

  private expireTokens(): void {
    const now = Date.now();
    for (const [token, record] of this.tokens) if (record.expiresAt <= now) this.tokens.delete(token);
  }
}
