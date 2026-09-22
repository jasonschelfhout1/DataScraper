import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { pruneCompletedCrawlTasks } from './prune.js';

describe('pruneCompletedCrawlTasks', () => {
  it('deletes only expired completed queue history and then vacuums the queue table', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ deleted: '4' }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await pruneCompletedCrawlTasks({ query } as unknown as Pool, 7);
    expect(result).toEqual({ completedTasksDeleted: 4 });
    expect(query.mock.calls[0]?.[0]).toContain("status = 'completed'");
    expect(query.mock.calls[0]?.[1]).toEqual([7]);
    expect(query).toHaveBeenLastCalledWith('VACUUM (ANALYZE) crawl_tasks');
  });
});
