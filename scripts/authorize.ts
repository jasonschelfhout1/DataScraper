import { chromium } from 'playwright';
import { parseProjectInput } from '../backend/src/validation.js';
import { saveSession } from '../backend/src/omgevingsloket/session.js';

const supplied = process.argv.slice(2).find((value) => !value.startsWith('--'));
const projectNumber = supplied ? parseProjectInput(supplied) : undefined;
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.goto(`https://omgevingsloketinzage.omgeving.vlaanderen.be/${projectNumber ?? ''}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  process.stdout.write('Complete the official browser verification. Press Enter here once the Omgevingsloket page is available.\n');
  await new Promise<void>((resolveEnter) => process.stdin.once('data', () => resolveEnter()));
  await saveSession((await context.cookies()).map(({ name, value, domain, expires }) => ({ name, value, domain, ...(expires > 0 ? { expires } : {}) })));
  console.log('Saved approved Omgevingsloket session cookies locally. Re-run this command when the session expires.');
} finally {
  await context.close();
  await browser.close();
}
