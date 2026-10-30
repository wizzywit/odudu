import type { Page, Request } from '@playwright/test';
import { expect, signIn, test } from './fixtures';
import { seeded } from './stack';

const { layout } = seeded().config.branding;

interface Call {
  method: string;
  // The admin path below the tenant, or the console's own: `session`.
  path: string;
  // The order requests were sent and answered in, whatever the clock says.
  sent: number;
  answered: number;
  // Milliseconds from the first call, for the table a run prints.
  start: number;
  end: number;
}

// The console's own calls: the session and the admin API through its gateway.
function recordCalls(page: Page): Call[] {
  const calls: Call[] = [];
  const pending = new Map<Request, Call>();
  let tick = 0;
  const origin = Date.now();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/console/api/') || path.includes('/preview')) return;
    const call = {
      method: request.method(),
      path: path.replace(/^\/console\/api\/(?:admin\/tenants\/[^/]+\/)?/u, ''),
      sent: (tick += 1),
      answered: 0,
      start: Date.now() - origin,
      end: 0,
    };
    pending.set(request, call);
    calls.push(call);
  });
  page.on('requestfinished', (request) => {
    const call = pending.get(request);
    if (call === undefined) return;
    call.answered = tick += 1;
    call.end = Date.now() - origin;
  });
  return calls;
}

const paths = (calls: readonly Call[]): string[] => calls.map((call) => call.path).sort();

async function openTab(page: Page, tab: string): Promise<Call[]> {
  await signIn(page, layout);
  const calls = recordCalls(page);
  await page.goto(`/console/${layout.tenant}/branding?tab=${tab}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  const rows = calls.map((call) =>
    [`${String(call.start)}-${String(call.end)}`, call.method, call.path].join(' '),
  );
  console.log(`WATERFALL ${tab} (${String(calls.length)} calls)\n${rows.join('\n')}`);
  return calls;
}

test('the Theme tab makes five admin calls on its first paint, none of them the languages’', async ({
  page,
}) => {
  const calls = await openTab(page, 'theme');
  expect(paths(calls)).toEqual([
    'session',
    'theme',
    'theme/stylesheet-hooks',
    'theme/versions',
    'whoami',
  ]);
});

test('the Pages tab adds the message catalogue to the theme, and nothing of the languages', async ({
  page,
}) => {
  const calls = await openTab(page, 'pages');
  expect(paths(calls)).toEqual(['message-catalogue', 'session', 'theme', 'whoami']);
});

test('the Languages tab reads the settings and the catalogue beside the theme, not after it', async ({
  page,
}) => {
  const calls = await openTab(page, 'languages');
  expect(paths(calls)).toEqual([
    'message-catalogue',
    'message-overrides',
    'session',
    'settings',
    'theme',
    'whoami',
  ]);
  const at = (path: string): Call => {
    const call = calls.find((found) => found.path === path);
    if (call === undefined) throw new Error(`no ${path} call`);
    return call;
  };
  expect(at('settings').sent).toBeLessThan(at('theme').answered);
  expect(at('message-catalogue').sent).toBeLessThan(at('theme').answered);
  expect(at('message-overrides').sent).toBeGreaterThan(at('settings').answered);
});

test('moving between tabs reads the catalogue once and the languages’ nothing before they are shown', async ({
  page,
}) => {
  const calls = await openTab(page, 'theme');
  for (const name of ['Pages', 'Theme', 'Pages']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
  }
  await page.waitForLoadState('networkidle');
  expect(calls.filter((call) => call.path === 'message-catalogue')).toHaveLength(1);
  expect(calls.filter((call) => call.path === 'settings')).toHaveLength(0);
  expect(calls.filter((call) => call.path === 'message-overrides')).toHaveLength(0);
});
