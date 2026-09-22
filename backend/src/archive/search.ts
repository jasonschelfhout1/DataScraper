import type { ArchiveProject } from './types.js';

/**
 * Dependency-free fuzzy ranking for the modest, deliberately capped local archive.
 * It is accent-insensitive and tolerates small spelling mistakes in project titles.
 */
export function rankProjectsByQuery(projects: ArchiveProject[], query: string): ArchiveProject[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [...projects].sort(byMostRecentlySeen);

  return projects
    .map((project) => ({ project, score: projectScore(project, normalizedQuery) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || byMostRecentlySeen(left.project, right.project))
    .map((candidate) => candidate.project);
}

function projectScore(project: ArchiveProject, query: string): number {
  const number = normalize(project.projectNumber);
  if (number === query) return 2_000;
  if (number.includes(query)) return 1_500;

  return Math.max(scoreText(project.title, query), scoreText(project.municipality, query) - 100);
}

function scoreText(value: string | undefined, query: string): number {
  const text = normalize(value ?? '');
  if (!text) return 0;
  if (text.includes(query)) return 1_000 + Math.min(query.length, 100);

  const queryWords = query.split(' ');
  const textWords = text.split(' ');
  let score = 0;
  for (const queryWord of queryWords) {
    const best = Math.max(...textWords.map((word) => wordScore(word, queryWord)), 0);
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

function wordScore(word: string, query: string): number {
  if (word === query) return 300;
  if (word.startsWith(query) || query.startsWith(word)) return 220;
  if (word.includes(query)) return 180;
  if (isSubsequence(query, word)) return 110;

  const distance = levenshtein(word, query);
  const similarity = 1 - distance / Math.max(word.length, query.length);
  return similarity >= 0.72 ? Math.round(similarity * 140) : 0;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function isSubsequence(query: string, value: string): boolean {
  let cursor = 0;
  for (const character of value) if (character === query[cursor]) cursor += 1;
  return cursor === query.length;
}

function levenshtein(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    previous = current;
  }
  return previous[right.length];
}

function byMostRecentlySeen(left: ArchiveProject, right: ArchiveProject): number { return right.lastSeenAt.localeCompare(left.lastSeenAt); }
