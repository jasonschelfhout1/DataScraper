import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type BrowserContext, type Request, type Response } from 'playwright';
import { parseProjectInput } from '../backend/src/validation.js';

const args = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const mode = args[0] === 'search' ? 'search' : args[0] === 'content' ? 'content' : args[0] === 'project' ? 'project' : 'project';
const rawInput = mode === 'search' ? undefined : args[args[0] === mode ? 1 : 0];
if (mode !== 'search' && !rawInput) throw new Error('Usage: npm run discover -- project <project> [--har] | search [--har] | content <project> [--har]');
const projectNumber = rawInput ? parseProjectInput(rawInput) : undefined;
const createHar = process.argv.includes('--har');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDirectory = resolve(process.cwd(), 'debug', 'discovery', `${mode}-${projectNumber ?? 'start'}-${timestamp}`);
const redactedHeaders = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'x-api-key']);
const seen = new Set<string>();

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /cookie|authorization|token|secret|password/i.test(key) ? '[REDACTED]' : key === 'postData' ? redactPayload(item) : redact(item)]));
  }
  return value;
}
function redactPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return redact(payload);
  try { return redact(JSON.parse(payload)); } catch { return '[NON_JSON_PAYLOAD_REDACTED]'; }
}
function safeUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/cookie|authorization|token|secret|password/i.test(key)) url.searchParams.set(key, '[REDACTED]');
  return url.toString();
}
function safeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, redactedHeaders.has(key.toLowerCase()) ? '[REDACTED]' : value]));
}
function requestRecord(request: Request): Record<string, unknown> {
  const url = new URL(request.url());
  return {
    method: request.method(), url: safeUrl(request.url()), resourceType: request.resourceType(),
    query: redact(Object.fromEntries(url.searchParams)), headers: safeHeaders(request.headers()), postData: redactPayload(request.postData()),
  };
}
async function writeJson(name: string, value: unknown): Promise<void> {
  await writeFile(resolve(outputDirectory, name), JSON.stringify(redact(value), null, 2), 'utf8');
}
async function waitForEnter(): Promise<void> {
  const instructions = mode === 'search'
    ? 'Complete official verification, then manually search a municipality, paginate results, change publication/authority filters, and pan or zoom the map.'
    : mode === 'content'
      ? 'Complete official verification, then open Inhoud aanvraag, a stedenbouwkundige handeling, Plannen en foto\'s, Detailinformatie, and one legitimately downloadable file.'
      : 'Complete official verification and open the project sections/documents you need captured.';
  process.stdout.write(`\n${instructions} Press Enter here when finished.\n`);
  await new Promise<void>((resolveEnter) => process.stdin.once('data', () => resolveEnter()));
}
async function sanitizeHar(path: string): Promise<void> {
  const data: unknown = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify(redact(data), null, 2), 'utf8');
}

await mkdir(outputDirectory, { recursive: true });
const harPath = resolve(outputDirectory, 'network.har');
const browser = await chromium.launch({ headless: false });
let context: BrowserContext | undefined;
try {
  context = await browser.newContext(createHar ? { recordHar: { path: harPath, content: 'omit' } } : {});
  const page = await context.newPage();
  page.on('request', (request) => {
    if (!['fetch', 'xhr'].includes(request.resourceType())) return;
    const key = `${request.method()} ${request.url()} ${request.postData() ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    void writeJson(`request-${seen.size}.json`, requestRecord(request));
    console.log(`${request.method()} ${safeUrl(request.url())}`);
  });
  page.on('response', (response) => { void captureResponse(response, seen.size); });
  page.on('download', (download) => { void writeJson(`download-${Date.now()}.json`, { url: download.url(), suggestedFilename: download.suggestedFilename() }); });
  await page.goto(`https://omgevingsloketinzage.omgeving.vlaanderen.be/${projectNumber ?? ''}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForEnter();
} finally {
  await context?.close();
  await browser.close();
}
if (createHar) await sanitizeHar(harPath);
await writeJson('summary.json', { mode, ...(projectNumber ? { projectNumber } : {}), capturedAt: new Date().toISOString(), uniqueRequests: seen.size, har: createHar ? 'network.har (headers redacted; response bodies omitted)' : undefined });
console.log(`Discovery evidence written to ${outputDirectory}`);

async function captureResponse(response: Response, sequence: number): Promise<void> {
  const request = response.request();
  const type = request.resourceType();
  if (!['fetch', 'xhr', 'document'].includes(type)) return;
  const headers = safeHeaders(await response.allHeaders());
  const contentType = headers['content-type'] ?? '';
  const metadata = { method: request.method(), url: safeUrl(response.url()), status: response.status(), resourceType: type, headers };
  await writeJson(`response-${sequence}-${Date.now()}.json`, metadata);
  if (contentType.includes('json')) {
    try { await writeJson(`response-${sequence}-${Date.now()}-body.json`, await response.json()); } catch { /* malformed JSON is represented by metadata */ }
  }
  if (/pdf|octet-stream|image\//i.test(contentType) || headers['content-disposition']) console.log(`Potential file response: ${response.status()} ${safeUrl(response.url())} (${contentType})`);
}
