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

/** A captured EPSG:31370 map viewport used by the official public search. */
export interface SearchBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Minimal public project metadata returned by the official map/search endpoint. */
export interface DiscoveredProject {
  projectNumber: string;
  upstreamUuid: string;
  upstreamPuuid?: string;
  title?: string;
  municipality?: string;
  address?: string;
  publicationType?: string;
}

export interface ProjectSearchPage {
  projects: DiscoveredProject[];
  page: number;
  totalPages: number;
  last: boolean;
}

export interface OmgevingsloketProvider {
  /** Confirmed public-map discovery. Only the caller-selected captured bounds are queried. */
  searchProjects(bounds: SearchBounds, page: number): Promise<ProjectSearchPage>;
  getProject(projectNumber: string): Promise<Project>;
  getDocuments(projectNumber: string): Promise<Document[]>;
  downloadDocument(projectNumber: string, documentId: string): Promise<DownloadStream>;
}
