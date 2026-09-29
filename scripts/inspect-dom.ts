import { chromium } from '@playwright/test';
import { urls } from '../src/utils/test-data';
import { detectRecaptcha, sanitizeUrl } from '../src/utils/diagnostics';

/**
 * Non-destructive DOM inspector.
 *
 * Re-runs the same read-only checks that were performed with Browser MCP, so
 * selector drift on the live site can be spotted without touching the backend.
 * It never clicks a Continue button and never submits a form.
 *
 *   npm run inspect
 */
type FieldInfo = {
  tag: string;
  type: string | null;
  id: string | null;
  placeholder: string | null;
  label: string | null;
  visible: boolean;
};

async function main(): Promise<void> {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome' });
  const page = await browser.newPage();

  const collect = () =>
    page.evaluate(() => {
      const labelFor = (id: string): string | null => {
        if (!id) return null;
        const label = document.querySelector(`label[for="${id}"]`);
        return label ? (label as HTMLElement).innerText.trim() : null;
      };
      return {
        url: location.href,
        title: document.title,
        formCount: document.querySelectorAll('form').length,
        fields: [...document.querySelectorAll('input, select, textarea')]
          .filter((el) => (el as HTMLInputElement).type !== 'hidden')
          .map((el) => {
            const input = el as HTMLInputElement;
            return {
              tag: input.tagName,
              type: input.type || null,
              id: input.id || null,
              placeholder: input.placeholder || null,
              label: labelFor(input.id),
              visible: Boolean(input.offsetWidth || input.offsetHeight),
            } satisfies FieldInfo;
          }),
        buttons: [...document.querySelectorAll('button, a[href]')]
          .map((el) => ({
            text: (el as HTMLElement).innerText.trim().slice(0, 48),
            id: (el as HTMLElement).id || null,
            href: el.getAttribute('href'),
            disabled: (el as HTMLButtonElement).disabled ?? null,
          }))
          .filter((b) => b.text),
      };
    });

  const report: Record<string, unknown> = {};

  await page.goto(urls.login, { waitUntil: 'domcontentloaded' });
  report.login = await collect();

  await page.goto(`${urls.elevateOrigin}${urls.forgotPasswordPath}`, {
    waitUntil: 'domcontentloaded',
  });
  report.forgotPassword = await collect();

  await page.goto(urls.freeTrial, { waitUntil: 'domcontentloaded' });
  await page.locator('#twVAEmail').waitFor({ state: 'visible' });
  report.signupStep1 = await collect();
  const recaptcha = await detectRecaptcha(page);
  report.recaptcha = { ...recaptcha, entryUrl: sanitizeUrl(page.url()) };

  await browser.close();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
