import { randomBytes } from 'node:crypto';
import {
  expect,
  expectAccessible,
  sessionTenant,
  signIn,
  signInAtTenant,
  test,
} from './fixtures.ts';
import { psql, seeded, type Account } from './stack.ts';

const { admin, expiring, forced, other, system } = seeded();

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const SUBJECT = (account: Account): string =>
  `select u.subject_id from users u join tenants t on t.id = u.tenant_id ` +
  `where t.name = ${sqlText(account.tenant)} and u.username = ${sqlText(account.username)}`;

function consoleSessions(account: Account): number {
  return Number(
    psql(`select count(*) from console_sessions where subject_id in (${SUBJECT(account)})`),
  );
}

test('a tenant administrator signs in from the console and changes a forced password', async ({
  page,
}) => {
  await page.goto('/console/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Which tenant do you administer?').fill(forced.tenant);
  await page.getByRole('button', { name: 'Continue to sign-in' }).click();

  await signInAtTenant(page, forced);
  await expect(page.getByRole('heading', { level: 1, name: 'Change your password' })).toBeVisible();
  const changed = { ...forced, password: randomBytes(18).toString('base64url') };
  await page.getByLabel('New password').fill(changed.password);
  await page.getByRole('button', { name: 'Update password' }).click();
  // The factor that authenticated runs again, now against the new password.
  await signInAtTenant(page, changed);

  await expect(page).toHaveURL(`/console/${forced.tenant}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText(`Signed in as ${forced.username}`)).toBeVisible();
  expect(await sessionTenant(page)).toBe(forced.tenant);
  await expectAccessible(page);
});

test.fixme('the tenant sign-in pages pass axe', async ({ page }) => {
  // Unstyled, their buttons fall short of WCAG 2.2's 24px target size
  // (target-size, on #passkey-submit) until the server's pages are themed.
  await page.goto(`/console/${admin.tenant}`);
  await expect(page.getByLabel('Username')).toBeVisible();
  await expectAccessible(page);
});

test('a system administrator enters a tenant with the context bar and no second sign-in', async ({
  page,
}) => {
  await signIn(page, system);
  const left: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && !new URL(frame.url()).pathname.startsWith('/console/')) {
      left.push(frame.url());
    }
  });

  await page.getByRole('link', { name: 'Switch tenant' }).click();
  await page.getByLabel('Which tenant do you administer?').fill(admin.tenant);
  await expectAccessible(page);
  await page.getByRole('button', { name: `Enter ${admin.tenant}` }).click();

  await expect(page).toHaveURL(`/console/${admin.tenant}`);
  const bar = page.getByRole('region', { name: 'System authority' });
  await expect(bar).toHaveText(`SystemActing in ${admin.tenant} with system authority`);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expectAccessible(page);
  expect(left).toEqual([]);
  expect(await sessionTenant(page)).toBe('system');
});

test.describe('a tenant administrator opening another tenant', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, admin);
    await page.goto(`/console/${other.tenant}`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Signed in to ${admin.tenant}` }),
    ).toBeVisible();
  });

  test('is asked first, and going back keeps the session', async ({ page }) => {
    await expectAccessible(page);
    await page.getByRole('link', { name: `Back to ${admin.tenant}` }).click();

    await expect(page).toHaveURL(`/console/${admin.tenant}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    expect(await sessionTenant(page)).toBe(admin.tenant);
  });

  test('keeps the old session when the other sign-in fails', async ({ page }) => {
    await page.getByRole('button', { name: `Sign in to ${other.tenant}` }).click();
    await signInAtTenant(page, { ...other, password: `not-${other.password}` });
    await expect(page.getByLabel('Password')).toBeVisible();
    expect(new URL(page.url()).pathname).toContain(`/tenants/${other.tenant}/`);

    expect(await sessionTenant(page)).toBe(admin.tenant);
    await page.goto(`/console/${admin.tenant}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });
});

test('a session that ends on the server signs in again and comes back to the page', async ({
  page,
}) => {
  await signIn(page, expiring);
  await page.getByRole('link', { name: 'Clients' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  const signIns: string[] = [];
  page.on('request', (request) => {
    if (
      request.isNavigationRequest() &&
      new URL(request.url()).pathname === '/console/auth/login'
    ) {
      signIns.push(request.url());
    }
  });

  expect(consoleSessions(expiring)).toBeGreaterThan(0);
  psql(`delete from console_sessions where subject_id in (${SUBJECT(expiring)})`);
  expect(consoleSessions(expiring)).toBe(0);
  // Only the page that comes back from the sign-in finds a session again.
  const back = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/console/api/session' && response.status() === 200,
  );
  await page.getByRole('link', { name: 'Subjects' }).click();
  await back;

  await expect(page).toHaveURL(`/console/${expiring.tenant}/subjects`);
  await expect(page.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
  expect(signIns).toHaveLength(1);
  expect(new URL(signIns[0] ?? '').searchParams.get('return_to')).toBe(
    `/console/${expiring.tenant}/subjects`,
  );
  expect(await sessionTenant(page)).toBe(expiring.tenant);
  expect(consoleSessions(expiring)).toBe(1);
});

test('a session that ends mid-edit restores the draft after sign-in and saves nothing', () => {
  test.skip(
    true,
    'No console section can be edited yet. The first feature with one brings this test, ' +
      'and with it the beforeunload prompt a dirty section registers.',
  );
});
