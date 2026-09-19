import { describe, expect, it, vi } from 'vitest';
import { TimedCache } from './cache.js';

describe('TimedCache', () => {
  it('expires values at the configured TTL', () => {
    vi.useFakeTimers();
    const cache = new TimedCache<string>(100);
    cache.set('project', 'value');
    expect(cache.get('project')).toBe('value');
    vi.advanceTimersByTime(101);
    expect(cache.get('project')).toBeUndefined();
    vi.useRealTimers();
  });
});
