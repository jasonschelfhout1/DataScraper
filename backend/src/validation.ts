import { z } from 'zod';
import { config } from './config.js';

const PROJECT_NUMBER = /^\d{10}$/;
const PREFIXED_PROJECT_NUMBER = /^omv_(\d{10})$/i;
export const documentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,128}$/, 'Invalid document ID');

export function parseProjectInput(input: string): string {
  const value = input.trim();
  if (PROJECT_NUMBER.test(value)) return value;

  const prefixed = PREFIXED_PROJECT_NUMBER.exec(value);
  if (prefixed) return prefixed[1];

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InputError('Enter a 10-digit project number or an official Omgevingsloket project URL.');
  }
  if (url.protocol !== 'https:' || url.hostname !== config.baseUrl.hostname || url.username || url.password || url.search || url.hash) {
    throw new InputError('The URL must be an HTTPS project URL from the official Omgevingsloket site.');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 1 || !PROJECT_NUMBER.test(segments[0])) {
    throw new InputError('The URL must point directly to a 10-digit project number.');
  }
  return segments[0];
}

export function assertAllowedUpstreamUrl(value: URL): void {
  if (value.protocol !== 'https:' || !config.allowedHosts.has(value.hostname) || value.username || value.password) {
    throw new InputError('An upstream URL is outside the approved Omgevingsloket hosts.');
  }
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}
