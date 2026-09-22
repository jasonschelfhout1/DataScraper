import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Pool } from 'pg';
import { config } from '../config.js';
import { UpstreamError } from '../omgevingsloket/errors.js';
import type { OmgevingsloketProvider } from '../omgevingsloket/types.js';
import { archiveObjectKey, type ObjectStore } from '../storage/object-store.js';
import { TaskRepository, type CrawlTask } from './task-repository.js';

export class ArchiveCrawler {
  private readonly tasks: TaskRepository;
  private lastRequestAt = 0;
  constructor(private readonly pool: Pool, private readonly provider: OmgevingsloketProvider, private readonly store: ObjectStore, private readonly logger: Logger) { this.tasks = new TaskRepository(pool); }
  async runBatch(): Promise<void> {
    const workerId = randomUUID(); const deadline = Date.now() + config.CRAWLER_BATCH_MAX_MS; let completed = 0;
    await this.tasks.bootstrap(); await this.tasks.recoverExpiredLeases();
    if (await this.tasks.isPaused()) { this.logger.warn('crawler paused; run manual authorization before resuming'); return; }
    this.logger.info({ workerId }, 'crawler run started');
    while (Date.now() < deadline && completed < config.CRAWLER_MAX_TASKS_PER_RUN) {
      const task = await this.tasks.claim(workerId, config.CRAWLER_TASK_LEASE_MS); if (!task) break;
      try { await this.execute(task); await this.tasks.complete(task.id); completed += 1; this.logger.info({ taskId: task.id, type: task.type }, 'crawl task completed'); }
      catch (error) { if (error instanceof ArchiveStorageLimitError) { await this.tasks.pause('archive_storage_limit_reached'); await this.tasks.retry(task, config.CRAWLER_RETRY_BASE_MS, error.message); this.logger.warn({ taskId: task.id, maxStorageBytes: config.ARCHIVE_MAX_STORAGE_BYTES }, 'crawler paused archive storage limit reached'); break; } if (error instanceof UpstreamError && error.kind === 'verification_required') { await this.tasks.pause('upstream_verification_required'); await this.tasks.retry(task, config.CRAWLER_RETRY_BASE_MS, 'upstream_verification_required'); this.logger.warn('crawler paused verification required'); break; } const delay = retryDelay(task.attempts); await this.tasks.retry(task, delay, error instanceof Error ? error.message : 'unknown crawler failure'); this.logger.warn({ taskId: task.id, delay }, 'crawl task rescheduled'); }
    }
    this.logger.info({ workerId, completed }, 'crawler run completed');
  }
  private async execute(task: CrawlTask): Promise<void> {
    if (task.type === 'discover_projects') return this.discoverProjects(task);
    if (task.type === 'crawl_project' || task.type === 'recheck_project') return this.crawlProject(task);
    if (task.type === 'download_document') return this.downloadDocument(task);
    throw new Error(`Unsupported crawl task type: ${task.type}`);
  }
  private async discoverProjects(task: CrawlTask): Promise<void> {
    if (!task.payload) throw new Error('Discovery task is missing a captured map bounding box.');
    await this.throttle();
    const result = await this.provider.searchProjects(task.payload.bounds, task.payload.page);
    for (const project of result.projects) {
      const inserted = await this.pool.query(`INSERT INTO projects (project_number, upstream_uuid, upstream_puuid, title, municipality, publication_type, source_metadata, crawl_status, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'pending',now()) ON CONFLICT (project_number) DO UPDATE SET upstream_uuid=EXCLUDED.upstream_uuid, upstream_puuid=EXCLUDED.upstream_puuid, title=EXCLUDED.title, municipality=EXCLUDED.municipality, publication_type=EXCLUDED.publication_type, source_metadata=EXCLUDED.source_metadata, last_seen_at=now(), updated_at=now() RETURNING id`, [project.projectNumber, project.upstreamUuid, project.upstreamPuuid ?? null, project.title ?? null, project.municipality ?? null, project.publicationType ?? null, JSON.stringify({ address: project.address ?? null, source: 'public_map_search' })]);
      await this.tasks.queueProject(inserted.rows[0].id);
    }
    if (!result.last && result.page + 1 < result.totalPages) await this.tasks.queueDiscovery({ bounds: task.payload.bounds, page: result.page + 1 });
    await this.pool.query(`UPDATE crawler_state SET last_discovery_at=now(), current_discovery_cursor=$1::jsonb WHERE id=1`, [JSON.stringify({ bounds: task.payload.bounds, page: result.page, totalPages: result.totalPages })]);
  }
  private async crawlProject(task: CrawlTask): Promise<void> {
    if (!task.projectId || !task.projectNumber) throw new Error('Project task is missing its project identity.');
    await this.throttle(); const project = await this.provider.getProject(task.projectNumber); await this.throttle(); const documents = await this.provider.getDocuments(task.projectNumber);
    await this.pool.query(`UPDATE projects SET title=$2, municipality=$3, status=$4, last_seen_at=now(), last_crawled_at=now(), crawl_status='completed', updated_at=now() WHERE id=$1`, [task.projectId, project.title ?? null, project.municipality ?? null, project.status ?? null]);
    for (const document of documents) { const status = document.downloadable ? 'pending' : 'view_only'; const result = await this.pool.query(`INSERT INTO documents (project_id, upstream_uuid, source_type, category, filename, description, mime_type, size_bytes, security_category, downloadable, download_status, source_metadata) VALUES ($1,$2,'procedure_event',$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (upstream_uuid) DO UPDATE SET filename=EXCLUDED.filename, description=EXCLUDED.description, mime_type=EXCLUDED.mime_type, size_bytes=EXCLUDED.size_bytes, downloadable=EXCLUDED.downloadable, download_status=CASE WHEN documents.download_status='downloaded' THEN 'downloaded' ELSE EXCLUDED.download_status END, last_seen_at=now(), updated_at=now() RETURNING id, download_status`, [task.projectId, document.id, document.category ?? null, document.name, document.description ?? null, document.mimeType ?? null, document.size ?? null, document.downloadable ? 'PUBLIEK_DOWNLOAD' : null, document.downloadable, status, JSON.stringify({ viewerUrl: document.viewerUrl ?? null })]);
      if (document.downloadable && result.rows[0].download_status !== 'downloaded') await this.pool.query(`INSERT INTO crawl_tasks (type, document_id, status, priority, max_attempts) VALUES ('download_document', $1, 'pending', 50, $2) ON CONFLICT DO NOTHING`, [result.rows[0].id, config.CRAWLER_MAX_ATTEMPTS]);
    }
  }
  private async downloadDocument(task: CrawlTask): Promise<void> {
    if (!task.documentId || !task.projectNumber || !task.documentUuid || !task.filename) throw new Error('Document task is missing archive identity.');
    if (task.storageKey) return;
    await this.throttle(); const file = await this.provider.downloadDocument(task.projectNumber, task.documentUuid);
    if (file.contentLength === undefined || !Number.isSafeInteger(file.contentLength) || file.contentLength <= 0) throw new ArchiveStorageLimitError('Archive storage cap requires an upstream Content-Length before a document can be stored.');
    const usage = await this.pool.query<{ archived_bytes: string }>(`SELECT COALESCE(sum(size_bytes), 0)::text AS archived_bytes FROM documents WHERE download_status='downloaded'`);
    const archivedBytes = Number(usage.rows[0]?.archived_bytes ?? 0);
    if (!Number.isSafeInteger(archivedBytes) || archivedBytes + file.contentLength > config.ARCHIVE_MAX_STORAGE_BYTES) throw new ArchiveStorageLimitError('Archive storage cap reached; no additional documents will be uploaded.');
    const key = archiveObjectKey(task.projectNumber, task.documentUuid, task.filename); const uploaded = await this.store.put(key, file.stream, file.contentType ?? task.mimeType);
    if (file.contentLength && file.contentLength !== uploaded.bytes) throw new Error('Archived byte count did not match upstream Content-Length.');
    await this.pool.query(`UPDATE documents SET storage_key=$2, sha256=$3, size_bytes=$4, mime_type=COALESCE($5,mime_type), download_status='downloaded', downloaded_at=now(), last_error=NULL, updated_at=now() WHERE id=$1`, [task.documentId, uploaded.key, uploaded.sha256, uploaded.bytes, file.contentType ?? null]);
  }
  private async throttle(): Promise<void> { const wait = Math.max(0, this.lastRequestAt + config.CRAWLER_MIN_REQUEST_DELAY_MS + Math.floor(Math.random() * config.CRAWLER_REQUEST_JITTER_MS) - Date.now()); if (wait) await new Promise((resolve) => setTimeout(resolve, wait)); this.lastRequestAt = Date.now(); }
}
class ArchiveStorageLimitError extends Error {}
function retryDelay(attempt: number): number { return Math.min(3_600_000, config.CRAWLER_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)); }
