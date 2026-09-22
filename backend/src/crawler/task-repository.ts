import type { Pool } from 'pg';
import type { SearchBounds } from '../omgevingsloket/types.js';

export interface DiscoveryPayload { bounds: SearchBounds; page: number; }
export interface CrawlTask { id: string; type: 'discover_projects' | 'crawl_project' | 'download_document' | 'recheck_project'; projectId?: string; documentId?: string; payload?: DiscoveryPayload; attempts: number; maxAttempts: number; projectNumber?: string; documentUuid?: string; filename?: string; mimeType?: string; storageKey?: string }

export class TaskRepository {
  constructor(private readonly pool: Pool) {}
  async bootstrap(): Promise<void> { await this.pool.query(`INSERT INTO crawler_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`); }
  async recoverExpiredLeases(): Promise<void> { await this.pool.query(`UPDATE crawl_tasks SET status = 'pending', locked_at = NULL, locked_by = NULL, lease_expires_at = NULL, updated_at = now() WHERE status = 'running' AND lease_expires_at < now()`); }
  async claim(workerId: string, leaseMs: number): Promise<CrawlTask | undefined> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const selected = await client.query(`SELECT t.*, p.project_number, d.upstream_uuid AS document_uuid, d.filename, d.mime_type, d.storage_key FROM crawl_tasks t LEFT JOIN documents d ON d.id = t.document_id LEFT JOIN projects p ON p.id = COALESCE(t.project_id, d.project_id) WHERE t.status = 'pending' AND t.next_attempt_at <= now() ORDER BY t.priority DESC, t.next_attempt_at, t.created_at FOR UPDATE OF t SKIP LOCKED LIMIT 1`); if (!selected.rows[0]) { await client.query('COMMIT'); return undefined; } const row = selected.rows[0]; await client.query(`UPDATE crawl_tasks SET status='running', attempts=attempts+1, locked_at=now(), locked_by=$2, lease_expires_at=now()+($3 * interval '1 millisecond'), updated_at=now() WHERE id=$1`, [row.id, workerId, leaseMs]); await client.query('COMMIT'); return { id: row.id, type: row.type, ...(row.project_id ? { projectId: row.project_id } : {}), ...(row.document_id ? { documentId: row.document_id } : {}), ...(isDiscoveryPayload(row.payload) ? { payload: row.payload } : {}), attempts: Number(row.attempts) + 1, maxAttempts: Number(row.max_attempts), ...(row.project_number ? { projectNumber: row.project_number } : {}), ...(row.document_uuid ? { documentUuid: row.document_uuid } : {}), ...(row.filename ? { filename: row.filename } : {}), ...(row.mime_type ? { mimeType: row.mime_type } : {}), ...(row.storage_key ? { storageKey: row.storage_key } : {}) }; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async complete(id: string): Promise<void> { await this.pool.query(`UPDATE crawl_tasks SET status='completed', completed_at=now(), locked_at=NULL, locked_by=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1`, [id]); }
  async retry(task: CrawlTask, delayMs: number, error: string): Promise<void> { const exhausted = task.attempts >= task.maxAttempts; await this.pool.query(`UPDATE crawl_tasks SET status=$2, next_attempt_at=now()+($3 * interval '1 millisecond'), last_error=$4, locked_at=NULL, locked_by=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1`, [task.id, exhausted ? 'failed' : 'pending', delayMs, error.slice(0, 500)]); }
  async pause(reason: string): Promise<void> { await this.pool.query(`INSERT INTO crawler_state (id, paused, pause_reason, last_heartbeat_at) VALUES (1, true, $1, now()) ON CONFLICT (id) DO UPDATE SET paused=true, pause_reason=EXCLUDED.pause_reason, last_heartbeat_at=now()`, [reason]); }
  async isPaused(): Promise<boolean> { const result = await this.pool.query(`SELECT paused FROM crawler_state WHERE id=1`); return result.rows[0]?.paused === true; }
  async queueDiscovery(payload: DiscoveryPayload, priority = 100): Promise<void> { await this.pool.query(`INSERT INTO crawl_tasks (type, payload, status, priority, max_attempts) SELECT 'discover_projects', $1::jsonb, 'pending', $2, $3 WHERE NOT EXISTS (SELECT 1 FROM crawl_tasks WHERE type='discover_projects' AND status IN ('pending','running') AND payload=$1::jsonb)`, [JSON.stringify(payload), priority, 5]); }
  async queueProject(projectId: string, priority = 75): Promise<void> { await this.pool.query(`INSERT INTO crawl_tasks (type, project_id, status, priority, max_attempts) SELECT 'crawl_project', $1, 'pending', $2, $3 WHERE NOT EXISTS (SELECT 1 FROM crawl_tasks WHERE type='crawl_project' AND project_id=$1 AND status IN ('pending','running'))`, [projectId, priority, 5]); }
}

function isDiscoveryPayload(value: unknown): value is DiscoveryPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>; const bounds = payload.bounds as Record<string, unknown> | undefined;
  return Number.isInteger(payload.page) && Number(payload.page) >= 0 && !!bounds && ['minX', 'minY', 'maxX', 'maxY'].every((key) => Number.isFinite(bounds[key]));
}
