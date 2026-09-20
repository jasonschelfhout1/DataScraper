import type { RequestHandler } from 'express';
import type { AppConfig } from './config.js';

interface Bucket { count: number; resetsAt: number }

/** Single-instance rate limiter for upstream-expensive project and download work. */
export function expensiveRequestLimiter(config: AppConfig): RequestHandler {
  const buckets = new Map<string, Bucket>();
  return (request, response, next) => {
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetsAt <= now) {
      buckets.set(key, { count: 1, resetsAt: now + config.EXPENSIVE_REQUEST_WINDOW_MS });
      return next();
    }
    if (bucket.count >= config.MAX_EXPENSIVE_REQUESTS_PER_WINDOW) {
      response.setHeader('retry-after', Math.ceil((bucket.resetsAt - now) / 1_000));
      return response.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' });
    }
    bucket.count += 1;
    return next();
  };
}
