import { describe, expect, it } from 'vitest';
import { filterDocuments, formatSize } from './filter';

const documents = [
  { id: 'a', projectNumber: '2026045710', name: 'Plan.pdf', category: 'Plans', downloadable: true },
  { id: 'b', projectNumber: '2026045710', name: 'Decision.pdf', description: 'Final decision', category: 'Decisions', downloadable: true },
];

describe('document filtering', () => {
  it('searches file names, descriptions, and categories', () => {
    expect(filterDocuments(documents, 'final', 'All')).toHaveLength(1);
    expect(filterDocuments(documents, '', 'Plans')).toEqual([documents[0]]);
  });
  it('formats file sizes for the document table', () => {
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize()).toBe('—');
  });
});
