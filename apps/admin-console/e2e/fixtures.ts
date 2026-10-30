import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import type { Account } from './stack';
import { traceFixture, tracing } from './trace';

// Reported by the browser for the one request the console expects to be
// refused: it reads its session to learn that it has none. The console only
// ever reads that path, so the path alone names GET /console/api/session; a
// 401 anywhere else is a failure unless its test calls `forgive`.
function expectedRefusal(text: string, url: string): boolean {
  return (
    (text.startsWith('Failed to load resource: the server responded with a status of 401') &&
      new URL(url).pathname === '/console/api/session') ||
    isSandboxedPreview(text)
  );
}

// The theme and mail previews are framed with no script allowed, so the browser refuses
// the script this harness puts in every frame it finds, and says so. That is
// the harness's own script, and the frame is meant to refuse scripts.
function isSandboxedPreview(text: string): boolean {
  return /^Blocked script execution in '[^']*\/(?:theme|mail)\/preview\?[^']*' because the document's frame is sandboxed/u.test(
    text,
  );
}

export interface Problem {
  readonly page: string;
  readonly source: string;
  readonly text: string;
}

// Every page fails its test on a policy violation or a console error, on
// the console's pages and on the tenant's own sign-in pages alike.
export const test = base.extend<{ problems: Problem[]; requestTrace: undefined }>({
  // Records the console's requests when E2E_TRACE names a file; otherwise
  // never set up, so a normal run is the run it always was.
  requestTrace: [traceFixture, { auto: tracing }],
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

// What a page waits for an answer the server works out (a subject's claims, a
// list read under load), where the default 5 s of an expectation is what a
// loaded runner can overrun while the server is well.
export const SERVER_COMPUTED = 15_000;

export const PHONE = { width: 390, height: 844 };
export const LAPTOP = { width: 1440, height: 900 };

// Presses Tab until `target` has focus; fails once `limit` presses have not
// reached it, which is how a page that makes its controls hard to reach is caught.
export function tabsWithin(limit: number) {
  return async (page: Page, target: Locator): Promise<void> => {
    for (let pressed = 0; pressed < limit; pressed += 1) {
      if (await target.evaluate((node) => node === document.activeElement)) return;
      await page.keyboard.press('Tab');
    }
    await expect(target).toBeFocused();
  };
}

// Tab enters a grid once; arrow keys then move between its cells, and a row's
// buttons are in its last cell. The walk down to `target` is made with `step`.
export function gridWalk({ tabs, step }: { tabs: number; step: 'ArrowDown' | 'Tab' }) {
  return async (page: Page, grid: Locator, target: Locator): Promise<void> => {
    for (let pressed = 0; pressed < tabs; pressed += 1) {
      if (await grid.evaluate((node) => node.contains(document.activeElement))) break;
      await page.keyboard.press('Tab');
    }
    for (let pressed = 0; pressed < 8; pressed += 1) {
      if (await page.evaluate(() => document.activeElement?.tagName === 'BUTTON')) break;
      await page.keyboard.press('ArrowRight');
    }
    for (let pressed = 0; pressed < 12; pressed += 1) {
      if (await target.evaluate((node) => node === document.activeElement)) return;
      await page.keyboard.press(step);
    }
    await expect(target).toBeFocused();
  };
}

// Reads the secret a SecretDialog shows once, acknowledges it and closes it.
export async function takeSecret(dialog: Locator): Promise<string> {
  const secret = await dialog.locator('code').first().innerText();
  await dialog.getByText(/^I have stored the /u).click();
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  return secret;
}

// A secret shown once is in neither the page nor what it keeps in the browser.
export async function expectNowhere(page: Page, secret: string): Promise<void> {
  expect(await page.content()).not.toContain(secret);
  const stored = await page.evaluate(() =>
    [sessionStorage, localStorage]
      .flatMap((storage) => Object.keys(storage).map((key) => storage.getItem(key) ?? ''))
      .join('\n'),
  );
  expect(stored).not.toContain(secret);
}

// Fails with the widest elements past the viewport's right edge, so a layout
// bug names its element rather than only its width.
export async function expectFitsViewport(page: Page, where = page.url()): Promise<void> {
  const report = await page.evaluate(() => {
    const view = document.documentElement.clientWidth;
    // An element's own box can sit inside the viewport while its text runs
    // out of it, so an overflowing content box counts too.
    const reach = (node: Element): number => {
      const box = node.getBoundingClientRect();
      const inner =
        getComputedStyle(node).overflowX === 'visible' ? node.scrollWidth - node.clientWidth : 0;
      return Math.max(box.right, inner > 1 ? box.left + node.scrollWidth : 0);
    };
    const past = [...document.body.querySelectorAll('*')]
      .map((node) => ({ node, right: reach(node) }))
      .filter(({ right }) => right > view + 0.5)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8)
      .map(
        ({ node, right }) =>
          `<${node.tagName.toLowerCase()} class="${node.getAttribute('class') ?? ''}"> ` +
          `${String(Math.round(right - view))}px beyond: ${node.textContent.trim().slice(0, 60)}`,
      );
    return { by: document.documentElement.scrollWidth - view, past };
  });
  expect(report.by, `${where}\n${report.past.join('\n')}`).toBeLessThanOrEqual(0);
}

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// The browser's scheme, and <html data-theme> overriding it either way.
const THEMES = [
  { scheme: 'light', override: null },
  { scheme: 'dark', override: null },
  { scheme: 'dark', override: 'light' },
  { scheme: 'light', override: 'dark' },
] as const;

// A picker option's accessible name leads with its visible name and adds its
// owner ("reader, a tenant role"), which axe 4.14's label-content-name-mismatch
// reads as not containing the whole visible line, detail included.
const ALWAYS_OFF = ['label-content-name-mismatch'];

// `disable` switches off a rule one open state is known to trip, named where
// it is passed; everything else still runs.
export async function expectAccessible(
  page: Page,
  {
    disable = [],
    exclude = [],
  }: {
    readonly disable?: readonly string[];
    // Selectors left out of the scan: a frame's own document is another page's,
    // and one with no script allowed cannot be scanned.
    readonly exclude?: readonly string[];
  } = {},
): Promise<void> {
  const chosen = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  const found: string[] = [];
  for (const { scheme, override } of THEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((theme) => {
      if (theme === null) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
    }, override);
    const builder = new AxeBuilder({ page })
      .withTags(WCAG_22_AA)
      .disableRules([...ALWAYS_OFF, ...disable]);
    for (const selector of exclude) builder.exclude(selector);
    const result = await builder.analyze();
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

// The console's own client skips the confirmation, so signing out ends the
// session at once and the person lands on the sign-in page.
export async function expectSignedOut(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
}

export async function sessionTenant(page: Page): Promise<string | null> {
  const response = await page.request.get('/console/api/session');
  if (response.status() !== 200) return null;
  const body: unknown = await response.json();
  return typeof body === 'object' && body !== null && 'tenant' in body ? String(body.tenant) : null;
}

// React Aria keeps the radio input itself out of reach of the pointer.
export async function chooseTheme(page: Page, name: string): Promise<void> {
  await page.getByRole('radiogroup', { name: 'Theme' }).getByText(name, { exact: true }).click();
  await expect(page.getByRole('radio', { name })).toBeChecked();
}
