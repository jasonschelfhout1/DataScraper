import { basename, extname } from 'node:path';

export function sanitizeFilename(input: string): string {
  const stripped = basename(input).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').trim();
  return stripped && stripped !== '.' && stripped !== '..' ? stripped.slice(0, 180) : 'document';
}

export function uniqueFilenames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const clean = sanitizeFilename(name);
    const key = clean.toLocaleLowerCase();
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    if (count === 0) return clean;
    const extension = extname(clean);
    const stem = extension ? clean.slice(0, -extension.length) : clean;
    let candidate = `${stem}-${count + 1}${extension}`;
    let suffix = count + 1;
    while (used.has(candidate.toLocaleLowerCase())) {
      suffix += 1;
      candidate = `${stem}-${suffix}${extension}`;
    }
    used.set(candidate.toLocaleLowerCase(), 1);
    return candidate;
  });
}
