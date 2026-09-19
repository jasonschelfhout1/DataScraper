import type { Readable } from 'node:stream';

export interface Project {
  projectNumber: string;
  title?: string;
  description?: string;
  address?: string;
  municipality?: string;
  status?: string;
}

export interface Document {
  /** Browser-safe upstream file identifier, always revalidated against the project listing. */
  id: string;
  projectNumber: string;
  name: string;
  description?: string;
  category?: string;
  mimeType?: string;
  size?: number;
  viewerUrl?: string;
  downloadable: boolean;
}

export interface DownloadStream {
  stream: Readable;
  filename: string;
  contentType?: string;
  contentLength?: number;
}

export interface OmgevingsloketProvider {
  getProject(projectNumber: string): Promise<Project>;
  getDocuments(projectNumber: string): Promise<Document[]>;
  downloadDocument(projectNumber: string, documentId: string): Promise<DownloadStream>;
}
