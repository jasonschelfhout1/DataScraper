import type { ArchiveDocument, ArchiveFilters, ArchiveProject, ArchiveStats } from './types';

export class ApiError extends Error {
  constructor(message: string, public readonly code?: string, public readonly status?: number) { super(message); }
}

let unauthorizedHandler: (() => void) | undefined;

export function onUnauthorized(handler: (() => void) | undefined): () => void {
  unauthorizedHandler = handler;
  return () => { if (unauthorizedHandler === handler) unauthorizedHandler = undefined; };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const error = body && typeof body === 'object' ? body as { message?: string; code?: string } : {};
    const apiError = new ApiError(error.message ?? 'The request could not be completed.', error.code, response.status);
    if (response.status === 401 && error.code === 'UNAUTHORIZED') unauthorizedHandler?.();
    throw apiError;
  }
  return response.json() as Promise<T>;
}

export const api = {
  authSession: () => request<AuthSession>('/api/auth/session'),
  login: (username: string, password: string) => request<AuthSession>('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  }),
  logout: () => request<AuthSession>('/api/auth/logout', { method: 'POST' }),
  searchArchive: (query: string, filters: ArchiveSearchOptions, page = 0, size = 15) => {
    const parameters = new URLSearchParams({ q: query, page: String(page), size: String(size), visibility: filters.visibility });
    if (filters.municipality) parameters.set('municipality', filters.municipality);
    if (filters.status) parameters.set('status', filters.status);
    if (filters.publicationType) parameters.set('publicationType', filters.publicationType);
    return request<{ projects: ArchiveProject[]; total: number }>(`/api/archive/projects?${parameters}`);
  },
  archiveFilters: () => request<ArchiveFilters>('/api/archive/filters'),
  archiveProject: (projectNumber: string) => request<ArchiveProject>(`/api/archive/projects/${encodeURIComponent(projectNumber)}`),
  archiveDocuments: async (projectNumber: string) => (await request<{ documents: ArchiveDocument[] }>(`/api/archive/projects/${encodeURIComponent(projectNumber)}/documents`)).documents,
  liveProject: (input: string) => request<ArchiveProject>(`/api/live/projects?input=${encodeURIComponent(input)}`),
  liveDocuments: async (projectNumber: string) => (await request<{ documents: ArchiveDocument[] }>(`/api/live/projects/${encodeURIComponent(projectNumber)}/documents`)).documents,
  archiveStatus: () => request<ArchiveStats>('/api/archive/status'),
};

export interface AuthSession {
  authenticated: boolean;
  username?: string;
}

export interface ArchiveSearchOptions {
  municipality: string;
  status: string;
  publicationType: string;
  visibility: 'all' | 'current' | 'historical';
}
