import { describe, expect, it } from 'vitest';
import { rankProjectsByQuery } from './search.js';
import type { ArchiveProject } from './types.js';

const projects: ArchiveProject[] = [
  { id: '1', projectNumber: '2026000001', title: 'Verbouwen van een woning', municipality: 'Antwerpen', isCurrentlyPublic: true, firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' },
  { id: '2', projectNumber: '2026000002', title: 'Nieuw kantoorgebouw', municipality: 'Gent', isCurrentlyPublic: true, firstSeenAt: '2026-01-02T00:00:00.000Z', lastSeenAt: '2026-01-02T00:00:00.000Z' },
];

describe('archive project search ranking', () => {
  it('matches a title without requiring its exact casing or accents', () => expect(rankProjectsByQuery(projects, 'verbouwen woning').map((project) => project.id)).toEqual(['1']));
  it('tolerates a small spelling mistake in a title', () => expect(rankProjectsByQuery(projects, 'verbowen').map((project) => project.id)).toEqual(['1']));
  it('continues to prioritise an exact project number', () => expect(rankProjectsByQuery(projects, '2026000002')[0]?.id).toBe('2'));
});
