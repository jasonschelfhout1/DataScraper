import type { Pool } from 'pg';

export interface PruneResult {
  completedTasksDeleted: number;
}

/**
 * Removes queue history only. Archived documents and their R2 object references
 * are deliberately retained so the archive remains searchable and downloadable.
 */
export async function pruneCompletedCrawlTasks(pool: Pool, retentionDays: number): Promise<PruneResult> {
  const result = await pool.query<{ deleted: string }>(`
    WITH removed AS (
      DELETE FROM crawl_tasks
      WHERE status = 'completed'
        AND completed_at < now() - ($1 * interval '1 day')
      RETURNING 1
    )
    SELECT count(*)::text AS deleted FROM removed
  `, [retentionDays]);
  // VACUUM reuses space without the exclusive lock required by VACUUM FULL.
  await pool.query('VACUUM (ANALYZE) crawl_tasks');
  return { completedTasksDeleted: Number(result.rows[0]?.deleted ?? 0) };
}
