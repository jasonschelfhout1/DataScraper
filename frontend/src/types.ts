export interface Project {
  projectNumber: string;
  title?: string;
  description?: string;
  address?: string;
  municipality?: string;
  status?: string;
}

export interface Document {
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

export interface DownloadJob {
  id: string;
  projectNumber: string;
  status: 'running' | 'completed' | 'failed';
  total: number;
  completed: number;
  failures: Array<{ documentId: string; name: string; message: string }>;
  downloadUrl?: string;
}
