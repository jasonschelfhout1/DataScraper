import type { RequestHandler } from 'express';
import type { AppConfig } from './config.js';

interface Bucket { count: number; resetsAt: number }

/** Single-instance rate limiter for upstream-expensive project and download work. */
export function expensiveRequestLimiter(config: AppConfig): RequestHandler {
  return fixedWindowLimiter(config.EXPENSIVE_REQUEST_WINDOW_MS, config.MAX_EXPENSIVE_REQUESTS_PER_WINDOW, 'RATE_LIMITED', 'Too many requests. Please try again shortly.');
}

/** Separate limiter for credential attempts; authenticated API traffic uses the existing limiter. */
export function loginAttemptLimiter(config: AppConfig): RequestHandler {
  return fixedWindowLimiter(config.AUTH_LOGIN_WINDOW_MS, config.AUTH_MAX_LOGIN_ATTEMPTS, 'LOGIN_RATE_LIMITED', 'Too many sign-in attempts. Please try again later.');
}

function fixedWindowLimiter(windowMs: number, maxRequests: number, code: string, message: string): RequestHandler {
  const buckets = new Map<string, Bucket>();
  return (request, response, next) => {
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetsAt <= now) {
      buckets.set(key, { count: 1, resetsAt: now + windowMs });
      return next();
    }
    if (bucket.count >= maxRequests) {
      response.setHeader('retry-after', Math.ceil((bucket.resetsAt - now) / 1_000));
      return response.status(429).json({ code, message });
    }
    bucket.count += 1;
    return next();
  };
}
