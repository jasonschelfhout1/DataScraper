import { config } from '../config.js';
import { assertAllowedUpstreamUrl } from '../validation.js';
import { UpstreamError } from './errors.js';
import { loadCookieHeader } from './session.js';

const transientStatuses = new Set([502, 503, 504]);

export class OmgevingsloketHttpClient {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async fetch(url: URL, init: RequestInit = {}): Promise<Response> {
    assertAllowedUpstreamUrl(url);
    await this.acquire();
    try {
      return await this.withRetry(url, init);
    } finally {
      this.release();
    }
  }

  private async withRetry(url: URL, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS);
      try {
        const cookie = await loadCookieHeader();
        const headers = new Headers(init.headers);
        headers.set('accept', headers.get('accept') ?? 'application/json, */*;q=0.8');
        headers.set('user-agent', 'Omgevingsloket-document-downloader/0.1 (local personal utility)');
        if (cookie) headers.set('cookie', cookie);
        const response = await this.fetchWithValidatedRedirects(url, { ...init, headers, signal: controller.signal });
        if (!transientStatuses.has(response.status) || attempt === 2) return response;
      } catch (error) {
        if (attempt === 2) throw new UpstreamError('The upstream request failed.', 'temporary');
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300 * (attempt + 1)));
    }
    throw new UpstreamError('The upstream request failed.', 'temporary');
  }

  async expectJson(url: URL): Promise<unknown> {
    const response = await this.fetch(url);
    if (response.status === 404) throw new UpstreamError('Project not found.', 'not_found', 404);
    if (response.status === 429) throw new UpstreamError('The upstream service rate limited this request.', 'rate_limited', 429);
    if (response.status >= 500) throw new UpstreamError('The upstream service is temporarily unavailable.', 'temporary', response.status);
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.includes('json')) {
      const body = contentType.includes('html') ? await response.text().catch(() => '') : '';
      if (/anubis|beveiligingscontrole/i.test(body)) {
        throw new UpstreamError('Official browser verification is required. Run npm run authorize and try again.', 'verification_required', response.status);
      }
      throw new UpstreamError('Expected JSON but received an unexpected upstream response.', 'unexpected', response.status);
    }
    return response.json() as Promise<unknown>;
  }

  private async fetchWithValidatedRedirects(url: URL, init: RequestInit, redirects = 0): Promise<Response> {
    if (redirects > 5) throw new UpstreamError('The upstream service redirected too many times.', 'unexpected');
    const response = await fetch(url, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) {
      if (config.DEBUG_OMGEVINGSLOKET) console.info(JSON.stringify({ upstream: response.url, method: init.method ?? 'GET', status: response.status, contentType: response.headers.get('content-type') }));
      return response;
    }
    const location = response.headers.get('location');
    if (!location) return response;
    const redirected = new URL(location, url);
    assertAllowedUpstreamUrl(redirected);
    return this.fetchWithValidatedRedirects(redirected, init, redirects + 1);
  }

  private async acquire(): Promise<void> {
    if (this.active < config.MAX_CONCURRENT_REQUESTS) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}
