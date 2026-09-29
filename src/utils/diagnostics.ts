import fs from 'node:fs';
import path from 'node:path';
import type { Page, Request, Response, TestInfo } from '@playwright/test';
import { secretValues } from './test-data';

/**
 * Sanitised diagnostics helpers.
 *
 * Rules enforced here:
 *  - request/response bodies are never captured,
 *  - query strings are stripped to their key names,
 *  - known secret values plus anything that looks like a card number, CVV, OTP,
 *    password field, bearer token or reCAPTCHA token is replaced with a marker.
 */

export const ARTIFACTS_DIR = path.resolve(process.cwd(), 'artifacts');

const REDACTED = '[REDACTED]';

const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(?:\d[ -]?){13,19}\b/g, // card-number shaped digit runs
  /"(?:password|passwd|pwd|cvv|cvc|otp|code|token|access_token|id_token|refresh_token|g-recaptcha-response|recaptchaToken)"\s*:\s*"[^"]*"/gi,
  /\b(?:password|pwd|cvv|cvc|otp|token|secret|apikey|api_key)=[^&\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b0[a-zA-Z0-9_-]{30,}\b/g, // reCAPTCHA v3 tokens start with "0c..." and are long
];

export function redact(input: string): string {
  let output = input;
  for (const secret of secretValues()) {
    output = output.split(secret).join(REDACTED);
  }
  for (const pattern of SENSITIVE_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

/** Keeps origin + pathname and the *names* of query parameters only. */
export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const keys = [...url.searchParams.keys()];
    const query = keys.length ? `?${keys.sort().join('&')}=<stripped>` : '';
    return redact(`${url.origin}${url.pathname}${query}`);
  } catch {
    return redact(rawUrl.split('?')[0]);
  }
}

export interface NetworkEntry {
  method: string;
  status: number | null;
  url: string;
  resourceType: string;
  failure?: string;
}

/** Third-party analytics/marketing noise we do not want in diagnostics. */
const NOISE =
  /google|doubleclick|facebook|linkedin|bing|pingdom|statsig|hotjar|clarity|segment|cdn\.jsdelivr|learnosity|vercel\/insights|capig\./i;

export interface NetworkRecorder {
  entries: NetworkEntry[];
  /** Entries on Thinkster-owned hosts, excluding static assets. */
  appCalls(): NetworkEntry[];
  find(substring: string): NetworkEntry | undefined;
  stop(): void;
}

export function recordNetwork(page: Page, options: { includeNoise?: boolean } = {}): NetworkRecorder {
  const entries: NetworkEntry[] = [];

  const onResponse = (response: Response) => {
    const url = response.url();
    if (!options.includeNoise && NOISE.test(url)) return;
    entries.push({
      method: response.request().method(),
      status: response.status(),
      url: sanitizeUrl(url),
      resourceType: response.request().resourceType(),
    });
  };

  const onFailed = (request: Request) => {
    const url = request.url();
    if (!options.includeNoise && NOISE.test(url)) return;
    entries.push({
      method: request.method(),
      status: null,
      url: sanitizeUrl(url),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText ?? 'unknown',
    });
  };

  page.on('response', onResponse);
  page.on('requestfailed', onFailed);

  return {
    entries,
    appCalls() {
      return entries.filter(
        (e) =>
          /hellothinkster\.com/i.test(e.url) &&
          !/\.(?:js|css|png|jpe?g|svg|webp|gif|ico|woff2?|map|json)$/i.test(e.url),
      );
    },
    find(substring: string) {
      return entries.find((e) => e.url.includes(substring));
    },
    stop() {
      page.off('response', onResponse);
      page.off('requestfailed', onFailed);
    },
  };
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function slug(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .toLowerCase();
}

/** Writes a redacted JSON artifact and attaches it to the Playwright report. */
export async function attachDiagnostics(
  testInfo: TestInfo,
  name: string,
  payload: unknown,
): Promise<string> {
  ensureDir(ARTIFACTS_DIR);
  const body = redact(JSON.stringify(payload, null, 2));
  const file = path.join(ARTIFACTS_DIR, `${slug(testInfo.title)}--${slug(name)}.json`);
  fs.writeFileSync(file, body, 'utf8');
  await testInfo.attach(`${name}.json`, { body, contentType: 'application/json' });
  return file;
}

/**
 * Screenshot helper for evidence on *passing* diagnostic tests.
 * Failure screenshots/traces/videos are handled by playwright.config.ts and are
 * deliberately not duplicated here.
 */
export async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  ensureDir(ARTIFACTS_DIR);
  const file = path.join(ARTIFACTS_DIR, `${slug(testInfo.title)}--${slug(name)}.png`);
  const buffer = await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(`${name}.png`, { body: buffer, contentType: 'image/png' });
}

/** Detects reCAPTCHA presence without solving, bypassing or logging any token. */
export async function detectRecaptcha(page: Page): Promise<{
  noticeVisible: boolean;
  anchorFrames: string[];
  challengeFrames: string[];
  tokenFieldPresent: boolean;
  grecaptchaLoaded: boolean;
}> {
  const anchorFrames = page
    .frames()
    .map((f) => f.url())
    .filter((u) => /recaptcha\/api2\/anchor/i.test(u))
    .map((u) => sanitizeUrl(u));
  const challengeFrames = page
    .frames()
    .map((f) => f.url())
    .filter((u) => /recaptcha\/api2\/bframe/i.test(u))
    .map((u) => sanitizeUrl(u));

  const tokenFieldPresent = await page
    .locator('textarea[name="g-recaptcha-response"]')
    .count()
    .then((c) => c > 0);
  const grecaptchaLoaded = await page.evaluate(
    () => typeof (window as unknown as { grecaptcha?: unknown }).grecaptcha !== 'undefined',
  );
  const noticeVisible = await page
    .getByText('This site is protected by reCAPTCHA', { exact: false })
    .first()
    .isVisible()
    .catch(() => false);

  return { noticeVisible, anchorFrames, challengeFrames, tokenFieldPresent, grecaptchaLoaded };
}

/** True when a visible interactive reCAPTCHA challenge is blocking the flow. */
export async function isRecaptchaBlocking(page: Page): Promise<boolean> {
  const bframe = page.frameLocator('iframe[src*="recaptcha/api2/bframe"]');
  return bframe
    .locator('#rc-imageselect, .rc-imageselect-instructions')
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
}
