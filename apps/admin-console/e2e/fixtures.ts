import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';
import type { Account } from './stack.ts';

// Reported by the browser for the one request the console expects to be
// refused: it reads its session to learn that it has none. The console only
// ever reads that path, so the path alone names GET /console/api/session; a
// 401 anywhere else is a failure unless its test calls `forgive`.
function expectedRefusal(text: string, url: string): boolean {
  return (
    text.startsWith('Failed to load resource: the server responded with a status of 401') &&
    new URL(url).pathname === '/console/api/session'
  );
}

export interface Problem {
  readonly page: string;
  readonly source: string;
  readonly text: string;
}

// Every page fails its test on a policy violation or a console error, on
// the console's pages and on the tenant's own sign-in pages alike.
export const test = base.extend<{ problems: Problem[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: Problem[] = [];
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(
            `securitypolicyviolation: ${event.violatedDirective} blocked ${event.blockedURI}`,
          );
        });
      });
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const source = message.location().url;
        if (expectedRefusal(message.text(), source)) return;
        problems.push({ page: page.url(), source, text: message.text() });
      });
      page.on('pageerror', (error) => {
        problems.push({ page: page.url(), source: '', text: String(error) });
      });
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

// A test that makes a request fail on purpose takes back what the browser
// logged about that request, and nothing else.
export function forgive(problems: Problem[], path: string): void {
  const kept = problems.filter((problem) => !problem.source.endsWith(path));
  problems.splice(0, problems.length, ...kept);
}

export { expect };

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// The browser's scheme, and <html data-theme> overriding it either way.
const THEMES = [
  { scheme: 'light', override: null },
  { scheme: 'dark', override: null },
  { scheme: 'dark', override: 'light' },
  { scheme: 'light', override: 'dark' },
] as const;

export async function expectAccessible(page: Page): Promise<void> {
  const chosen = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  const found: string[] = [];
  for (const { scheme, override } of THEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((theme) => {
      if (theme === null) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
    }, override);
    const result = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
    const ran = [...result.passes, ...result.violations, ...result.incomplete];
    if (!ran.some((rule) => rule.id === 'color-contrast')) {
      found.push(`${scheme}/${override ?? 'system'} color-contrast did not run`);
    }
    for (const violation of result.violations) {
      const where = violation.nodes.map((node) => node.target.join(' ')).join(', ');
      found.push(`${scheme}/${override ?? 'system'} ${violation.id}: ${where}`);
    }
  }
  await page.emulateMedia({ colorScheme: null });
  await page.evaluate((theme) => {
    if (theme === null) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, chosen);
  expect(found, page.url()).toEqual([]);
}

export async function signInAtTenant(page: Page, account: Account): Promise<void> {
  await page.getByLabel('Username').fill(account.username);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

// Straight to the tenant's sign-in, as a tenant named in the URL goes.
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto(`/console/${account.tenant}`);
  await signInAtTenant(page, account);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
}

export async function sessionTenant(page: Page): Promise<string | null> {
  const response = await page.request.get('/console/api/session');
  if (response.status() !== 200) return null;
  const body: unknown = await response.json();
  return typeof body === 'object' && body !== null && 'tenant' in body ? String(body.tenant) : null;
}
