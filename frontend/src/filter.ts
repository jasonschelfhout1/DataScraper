interface FilterableDocument { name?: string; filename?: string; description?: string; category?: string }

export function filterDocuments<T extends FilterableDocument>(documents: T[], text: string, category: string): T[] {
  const query = text.trim().toLocaleLowerCase();
  return documents.filter((document) => {
    const inCategory = category === 'All' || (document.category ?? 'Other') === category;
    const haystack = [document.name ?? document.filename, document.description, document.category].filter(Boolean).join(' ').toLocaleLowerCase();
    return inCategory && (!query || haystack.includes(query));
  });
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${(bytes / 1024 ** (unit + 1)).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
