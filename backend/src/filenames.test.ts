import { describe, expect, it } from 'vitest';
import { sanitizeFilename, uniqueFilenames } from './filenames.js';

describe('filenames', () => {
  it('removes traversal and unsafe filename characters', () => {
    expect(sanitizeFilename('../plan:final?.pdf')).toBe('plan_final_.pdf');
    expect(sanitizeFilename('...')).toBe('document');
  });
  it('adds deterministic suffixes for duplicate names', () => {
    expect(uniqueFilenames(['plan.pdf', 'Plan.pdf', 'plan.pdf'])).toEqual(['plan.pdf', 'Plan-2.pdf', 'plan-3.pdf']);
  });
});
