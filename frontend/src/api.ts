import type { ArchiveDocument, ArchiveProject, ArchiveStats } from './types';

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
  searchArchive: (query: string, page = 0) => request<{ projects: ArchiveProject[]; total: number }>(`/api/archive/projects?q=${encodeURIComponent(query)}&page=${page}`),
  archiveProject: (projectNumber: string) => request<ArchiveProject>(`/api/archive/projects/${encodeURIComponent(projectNumber)}`),
  archiveDocuments: async (projectNumber: string) => (await request<{ documents: ArchiveDocument[] }>(`/api/archive/projects/${encodeURIComponent(projectNumber)}/documents`)).documents,
  archiveStatus: () => request<ArchiveStats>('/api/archive/status'),
};

export interface AuthSession {
  authenticated: boolean;
  username?: string;
}
