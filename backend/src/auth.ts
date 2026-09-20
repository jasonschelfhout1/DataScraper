import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import cookieSession from 'cookie-session';
import { z } from 'zod';
import { config } from './config.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(500),
});

export function configureSession(): RequestHandler {
  return cookieSession({
    name: 'datascraper_session',
    keys: [config.AUTH_SESSION_SECRET ?? 'test-session-secret-not-for-production'],
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    maxAge: config.AUTH_SESSION_MAX_AGE_MS,
    path: '/',
  });
}

export function authenticateCredentials(username: string, password: string): boolean {
  if (!config.AUTH_USERNAME || !config.AUTH_PASSWORD) return false;
  return safeEqual(username, config.AUTH_USERNAME) && safeEqual(password, config.AUTH_PASSWORD);
}

export function login(request: Request, response: Response, next: NextFunction): void {
  try {
    const credentials = loginSchema.parse(request.body);
    if (!authenticateCredentials(credentials.username, credentials.password)) {
      response.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
      return;
    }
    request.session = { authenticated: true, username: config.AUTH_USERNAME };
    response.json({ authenticated: true, username: config.AUTH_USERNAME });
  } catch (error) {
    next(error);
  }
}

export function logout(request: Request, response: Response): void {
  request.session = null;
  response.json({ authenticated: false });
}

export function sessionStatus(request: Request, response: Response): void {
  if (isAuthenticated(request)) {
    response.json({ authenticated: true, username: config.AUTH_USERNAME });
    return;
  }
  response.json({ authenticated: false });
}

export const requireAuthentication: RequestHandler = (request, response, next) => {
  if (isAuthenticated(request)) return next();
  return response.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
};

function isAuthenticated(request: Request): boolean {
  return request.session?.authenticated === true && request.session.username === config.AUTH_USERNAME;
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
