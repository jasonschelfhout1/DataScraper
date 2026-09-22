export interface ArchiveProject {
  id: string;
  projectNumber: string;
  title?: string;
  municipality?: string;
  status?: string;
  publicationType?: string;
  isCurrentlyPublic: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCrawledAt?: string;
  documentCount?: number;
}

export interface ArchiveDocument {
  id: string;
  projectNumber: string;
  upstreamUuid: string;
  filename: string;
  description?: string;
  category?: string;
  mimeType?: string;
  sizeBytes?: number;
  viewerUrl?: string;
  downloadable: boolean;
  downloadStatus: string;
  storageKey?: string;
  firstSeenAt: string;
}

export interface ArchiveStats { projects: number; currentlyPublicProjects: number; documents: number; archivedDocuments: number; viewOnlyDocuments: number; pendingDownloads: number; failedDownloads: number; pendingTasks: number; paused: boolean; pauseReason?: string; lastSuccessfulUpstreamRequestAt?: string }

export interface ArchiveFilters { municipalities: string[]; statuses: string[]; publicationTypes: string[] }
