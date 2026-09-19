import { createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { config } from './config.js';
import { uniqueFilenames } from './filenames.js';
import type { Document, OmgevingsloketProvider } from './omgevingsloket/types.js';

export interface DownloadFailure { documentId: string; name: string; message: string }
export interface DownloadJobReport {
  id: string;
  projectNumber: string;
  status: 'running' | 'completed' | 'failed';
  total: number;
  completed: number;
  failures: DownloadFailure[];
  downloadUrl?: string;
}

interface DownloadJob extends DownloadJobReport {
  archivePath: string;
  createdAt: number;
  listeners: Set<(report: DownloadJobReport) => void>;
}

const jobsDirectory = resolve(config.localDirectory, 'downloads');

export class DownloadJobs {
  private readonly jobs = new Map<string, DownloadJob>();

  constructor(private readonly provider: OmgevingsloketProvider) {
    setInterval(() => this.expire(), 60_000).unref();
  }

  start(projectNumber: string, documents: Document[]): DownloadJobReport {
    const id = randomUUID();
    const job: DownloadJob = {
      id, projectNumber, status: 'running', total: documents.length, completed: 0, failures: [],
      archivePath: resolve(jobsDirectory, `omgevingsloket-${projectNumber}-${id}.zip`), createdAt: Date.now(), listeners: new Set(),
    };
    this.jobs.set(id, job);
    void this.createArchive(job, documents);
    return this.report(job);
  }

  get(id: string): DownloadJobReport | undefined {
    const job = this.jobs.get(id);
    return job ? this.report(job) : undefined;
  }

  archivePath(id: string): string | undefined {
    const job = this.jobs.get(id);
    return job?.status === 'completed' ? job.archivePath : undefined;
  }

  subscribe(id: string, listener: (report: DownloadJobReport) => void): (() => void) | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    job.listeners.add(listener);
    listener(this.report(job));
    return () => job.listeners.delete(listener);
  }

  private async createArchive(job: DownloadJob, documents: Document[]): Promise<void> {
    try {
      await mkdir(jobsDirectory, { recursive: true });
      const output = createWriteStream(job.archivePath, { flags: 'w', mode: 0o600 });
      const outputClosed = once(output, 'close');
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('warning', (error: Error) => job.failures.push({ documentId: 'archive', name: 'archive', message: error.message }));
      archive.pipe(output);
      const names = uniqueFilenames(documents.map((document) => document.name));
      for (const [index, document] of documents.entries()) {
        try {
          const file = await this.provider.downloadDocument(job.projectNumber, document.id);
          archive.append(file.stream, { name: names[index] });
          await once(file.stream, 'end');
        } catch (error) {
          job.failures.push({ documentId: document.id, name: document.name, message: 'Could not download this document.' });
        }
        job.completed += 1;
        this.notify(job);
      }
      await archive.finalize();
      await outputClosed;
      job.status = 'completed';
    } catch {
      job.status = 'failed';
    }
    this.notify(job);
  }

  private report(job: DownloadJob): DownloadJobReport {
    return {
      id: job.id, projectNumber: job.projectNumber, status: job.status, total: job.total,
      completed: job.completed, failures: job.failures,
      ...(job.status === 'completed' ? { downloadUrl: `/api/downloads/${job.id}/file` } : {}),
    };
  }

  private notify(job: DownloadJob): void {
    const report = this.report(job);
    job.listeners.forEach((listener) => listener(report));
  }

  private expire(): void {
    const oldest = Date.now() - config.DOWNLOAD_JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.createdAt >= oldest) continue;
      this.jobs.delete(id);
      if (existsSync(job.archivePath)) unlinkSync(job.archivePath);
    }
  }
}
