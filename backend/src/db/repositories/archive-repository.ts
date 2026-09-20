import type { Pool } from 'pg';
import type { ArchiveDocument, ArchiveProject, ArchiveRepository, ArchiveStats } from '../../archive/types.js';

export class PgArchiveRepository implements ArchiveRepository {
  constructor(private readonly pool: Pool) {}

  async searchProjects(query: string, page: number, size: number): Promise<{ projects: ArchiveProject[]; total: number }> {
    const pattern = `%${query.trim()}%`;
    const result = await this.pool.query(`SELECT p.id, p.project_number, p.title, p.municipality, p.status, p.is_currently_public, p.first_seen_at, p.last_seen_at, p.last_crawled_at, count(d.id)::int AS document_count, count(*) OVER()::int AS total FROM projects p LEFT JOIN documents d ON d.project_id = p.id WHERE ($1 = '%%' OR p.project_number ILIKE $1 OR COALESCE(p.title, '') ILIKE $1 OR COALESCE(p.municipality, '') ILIKE $1) GROUP BY p.id ORDER BY p.last_seen_at DESC LIMIT $2 OFFSET $3`, [pattern, size, page * size]);
    return { projects: result.rows.map(projectRow), total: Number(result.rows[0]?.total ?? 0) };
  }
  async getProject(projectNumber: string): Promise<ArchiveProject | undefined> {
    const result = await this.pool.query(`SELECT p.id, p.project_number, p.title, p.municipality, p.status, p.is_currently_public, p.first_seen_at, p.last_seen_at, p.last_crawled_at, count(d.id)::int AS document_count FROM projects p LEFT JOIN documents d ON d.project_id = p.id WHERE p.project_number = $1 GROUP BY p.id`, [projectNumber]);
    return result.rows[0] ? projectRow(result.rows[0]) : undefined;
  }
  async getDocuments(projectNumber: string): Promise<ArchiveDocument[]> {
    const result = await this.pool.query(`SELECT d.id, p.project_number, d.upstream_uuid, d.filename, d.description, d.category, d.mime_type, d.size_bytes, d.downloadable, d.download_status, d.storage_key, d.first_seen_at FROM documents d JOIN projects p ON p.id = d.project_id WHERE p.project_number = $1 ORDER BY d.filename`, [projectNumber]);
    return result.rows.map(documentRow);
  }
  async getDocument(id: string): Promise<ArchiveDocument | undefined> {
    const result = await this.pool.query(`SELECT d.id, p.project_number, d.upstream_uuid, d.filename, d.description, d.category, d.mime_type, d.size_bytes, d.downloadable, d.download_status, d.storage_key, d.first_seen_at FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.id = $1`, [id]);
    return result.rows[0] ? documentRow(result.rows[0]) : undefined;
  }
  async stats(): Promise<ArchiveStats> {
    const result = await this.pool.query(`SELECT (SELECT count(*)::int FROM projects) AS projects, (SELECT count(*)::int FROM projects WHERE is_currently_public) AS current_projects, (SELECT count(*)::int FROM documents) AS documents, (SELECT count(*)::int FROM documents WHERE download_status = 'downloaded') AS archived, (SELECT count(*)::int FROM documents WHERE download_status = 'view_only') AS view_only, (SELECT count(*)::int FROM documents WHERE download_status = 'pending') AS pending_downloads, (SELECT count(*)::int FROM documents WHERE download_status = 'failed') AS failed_downloads, (SELECT count(*)::int FROM crawl_tasks WHERE status = 'pending') AS pending_tasks, (SELECT paused FROM crawler_state WHERE id = 1) AS paused, (SELECT pause_reason FROM crawler_state WHERE id = 1) AS pause_reason, (SELECT last_successful_upstream_request_at FROM crawler_state WHERE id = 1) AS last_successful`);
    const row = result.rows[0] ?? {};
    return { projects: Number(row.projects ?? 0), currentlyPublicProjects: Number(row.current_projects ?? 0), documents: Number(row.documents ?? 0), archivedDocuments: Number(row.archived ?? 0), viewOnlyDocuments: Number(row.view_only ?? 0), pendingDownloads: Number(row.pending_downloads ?? 0), failedDownloads: Number(row.failed_downloads ?? 0), pendingTasks: Number(row.pending_tasks ?? 0), paused: Boolean(row.paused), ...(row.pause_reason ? { pauseReason: row.pause_reason } : {}), ...(row.last_successful ? { lastSuccessfulUpstreamRequestAt: new Date(row.last_successful).toISOString() } : {}) };
  }
}

function projectRow(row: Record<string, unknown>): ArchiveProject { return { id: String(row.id), projectNumber: String(row.project_number), ...(row.title ? { title: String(row.title) } : {}), ...(row.municipality ? { municipality: String(row.municipality) } : {}), ...(row.status ? { status: String(row.status) } : {}), isCurrentlyPublic: Boolean(row.is_currently_public), firstSeenAt: new Date(String(row.first_seen_at)).toISOString(), lastSeenAt: new Date(String(row.last_seen_at)).toISOString(), ...(row.last_crawled_at ? { lastCrawledAt: new Date(String(row.last_crawled_at)).toISOString() } : {}), documentCount: Number(row.document_count ?? 0) }; }
function documentRow(row: Record<string, unknown>): ArchiveDocument { return { id: String(row.id), projectNumber: String(row.project_number), upstreamUuid: String(row.upstream_uuid), filename: String(row.filename), ...(row.description ? { description: String(row.description) } : {}), ...(row.category ? { category: String(row.category) } : {}), ...(row.mime_type ? { mimeType: String(row.mime_type) } : {}), ...(row.size_bytes !== null && row.size_bytes !== undefined ? { sizeBytes: Number(row.size_bytes) } : {}), downloadable: Boolean(row.downloadable), downloadStatus: String(row.download_status), ...(row.storage_key ? { storageKey: String(row.storage_key) } : {}), firstSeenAt: new Date(String(row.first_seen_at)).toISOString() }; }
