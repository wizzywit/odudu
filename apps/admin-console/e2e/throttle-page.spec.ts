import { expect, forgive, test } from './fixtures';
import { inspect } from './page-inspection';
import { startThrottledServer, stopThrottledServer } from './stack';

// Both tests share one container with a fixed name and port, so they must share
// one worker: fullyParallel would give each its own beforeAll, and the second
// one's failure to start (name in use) would remove the first one's server.
test.describe.configure({ mode: 'serial' });

const PORT = 3981;
const ORIGIN = `http://127.0.0.1:${String(PORT)}`;

test.beforeAll(async () => {
  startThrottledServer(PORT);
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${ORIGIN}/health/ready`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 60_000 },
    )
    .toBe(200);
});

test.afterAll(() => {
  stopThrottledServer();
});

test('the throttled sign-in page names the wait and passes axe in both themes', async ({
  page,
  request,
  problems,
}) => {
  const url = `${ORIGIN}/tenants/anything/login-actions/reset-password`;
  await request.post(url, { form: { email: 'nobody@example.test' } });
  const refused = await request.post(url, { form: { email: 'nobody@example.test' } });

  expect(refused.status()).toBe(429);
  expect(refused.headers()['cache-control']).toBe('no-store');
  const wait = Number(refused.headers()['retry-after']);
  // Served the way the server sent it, so the stylesheet its policy allows loads.
  const view = `${ORIGIN}/throttled-view`;
  await page.route(view, (route) => route.fulfill({ response: refused }));
  await page.goto(view);
  await expect(page.getByRole('heading', { level: 1, name: 'Too many attempts' })).toBeVisible();
  await expect(page.getByText(`Try again in ${String(wait)} seconds.`)).toBeVisible();
  await inspect(page, 'throttle');
  forgive(problems, '/throttled-view');
});

// Arabic has six plural categories, so the wait is said in the form its count
// takes; the form for each count is held by the catalogue's own tests.
const ARABIC_WAIT: Record<string, (seconds: number) => string> = {
  zero: (n) => `${String(n)} ثانية`,
  one: () => 'ثانية واحدة',
  two: () => 'ثانيتين',
  few: (n) => `${String(n)} ثوانٍ`,
  many: (n) => `${String(n)} ثانية`,
  other: (n) => `${String(n)} ثانية`,
};

test('the throttled page in Arabic names the wait in its plural form', async ({
  page,
  request,
  problems,
}) => {
  const url = `${ORIGIN}/tenants/anything/login-actions/reset-password`;
  const headers = { 'accept-language': 'ar' };
  await request.post(url, { form: { email: 'nobody@example.test' }, headers });
  const refused = await request.post(url, { form: { email: 'nobody@example.test' }, headers });

  expect(refused.status()).toBe(429);
  const wait = Number(refused.headers()['retry-after']);
  const view = `${ORIGIN}/throttled-view-ar`;
  await page.route(view, (route) => route.fulfill({ response: refused }));
  await page.goto(view);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const form = ARABIC_WAIT[new Intl.PluralRules('ar').select(wait)];
  await expect(page.getByText(`حاول مرة أخرى بعد ${form?.(wait) ?? ''}.`)).toBeVisible();
  await inspect(page, 'ar-throttle');
  forgive(problems, '/throttled-view-ar');
});
