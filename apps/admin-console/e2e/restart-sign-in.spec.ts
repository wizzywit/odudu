import type { Page } from '@playwright/test';
import { expectSignedOut, expect, forgive, signInAtTenant, test } from './fixtures';
import { psql, seeded } from './stack';

const account = seeded().other;
// The browser logs the 400 a refusal page is served with.
const REFUSAL_PATH = '/login-actions/authenticate';
const NOTICE = 'This sign-in attempt is no longer valid. Go back and start again.';

async function formSessionId(page: Page): Promise<string> {
  const field = page.locator('input[name="auth_session_id"]').first();
  await expect(field).toBeAttached();
  return field.inputValue();
}

function reloadsOnRestore(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.scripts].some((script) => script.textContent.includes('pageshow')),
  );
}

function expire(authSessionId: string): void {
  psql(
    `update authentication_sessions set expires_at = now() - interval '1 second' where id = '${authSessionId}'`,
  );
  expect(
    psql(
      `select count(*) from authentication_sessions where id = '${authSessionId}' and expires_at < now()`,
    ),
  ).toBe('1');
}

// The sign-in the console starts for the tenant, its form left open, and the
// session behind that form ended before anything is submitted.
async function openExpiredForm(page: Page): Promise<string> {
  await page.goto(`/console/${account.tenant}`);
  const stale = await formSessionId(page);
  expire(stale);
  return stale;
}

async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
}

test('an expired sign-in form offers to start again, and the link signs in', async ({
  page,
  problems,
}) => {
  const stale = await openExpiredForm(page);
  await signInAtTenant(page, account);

  await expect(page.getByText(NOTICE)).toBeVisible();
  forgive(problems, REFUSAL_PATH);
  await page.getByRole('link', { name: 'Start sign-in again' }).click();
  expect(await formSessionId(page)).not.toBe(stale);
  await signInAtTenant(page, account);
  await expectSignedIn(page);
});

test('Back from the refusal is a form that was fetched again, and signs in', async ({
  page,
  problems,
}) => {
  const stale = await openExpiredForm(page);
  await signInAtTenant(page, account);
  await expect(page.getByText(NOTICE)).toBeVisible();
  forgive(problems, REFUSAL_PATH);

  await page.goBack();
  await expect(page.getByLabel('Username')).toBeVisible();
  expect(await formSessionId(page)).not.toBe(stale);
  await signInAtTenant(page, account);
  await expectSignedIn(page);
});

test('every sign-in page is sent no-store, and only the GET form carries the reload script', async ({
  page,
}) => {
  const authorize = page.waitForResponse((r) =>
    new URL(r.url()).pathname.endsWith('/protocol/openid-connect/auth'),
  );
  await page.goto(`/console/${account.tenant}`);
  expect((await authorize).headers()['cache-control']).toBe('no-store');
  await expect(page.getByLabel('Username')).toBeVisible();
  expect(await reloadsOnRestore(page)).toBe(true);

  await page.getByLabel('Username').fill(account.username);
  await page.getByLabel('Password').fill('not the password');
  const rejected = page.waitForResponse((r) =>
    new URL(r.url()).pathname.endsWith('/login-actions/authenticate'),
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const answer = await rejected;
  expect(answer.headers()['cache-control']).toBe('no-store');
  expect(await reloadsOnRestore(page)).toBe(false);
});

test('Back after signing out shows no signed-in page', async ({ page }) => {
  await page.goto(`/console/${account.tenant}`);
  await signInAtTenant(page, account);
  await expectSignedIn(page);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expectSignedOut(page);

  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeHidden();
  await expect(page.getByText(account.username)).toBeHidden();
});
