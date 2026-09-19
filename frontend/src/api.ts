import type { Document, DownloadJob, Project } from './types';

export class ApiError extends Error {
  constructor(message: string, public readonly code?: string, public readonly status?: number) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const error = body && typeof body === 'object' ? body as { message?: string; code?: string } : {};
    throw new ApiError(error.message ?? 'The request could not be completed.', error.code, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  project: (projectNumber: string) => request<Project>(`/api/projects/${encodeURIComponent(projectNumber)}`),
  documents: async (projectNumber: string) => (await request<{ documents: Document[] }>(`/api/projects/${encodeURIComponent(projectNumber)}/documents`)).documents,
  startDownload: (projectNumber: string, documentIds: string[]) => request<DownloadJob>(`/api/projects/${encodeURIComponent(projectNumber)}/downloads`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentIds }),
  }),
};
