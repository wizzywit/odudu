import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, signInAtTenant, test } from './fixtures';
import { BASE } from './page-inspection';
import { inTenant, psql, seed, sqlText } from './stack';
import { randomPassword } from './password';

// A link mailed out of the console's own sign-in (a password reset, an email
// verification) brings the person back to that sign-in, in the browser that
// started it, so the console's callback finds the state it asked for and the
// person lands signed in. In any other browser, or once the sign-in has
// lapsed, the page says what to do and offers no link: a link that started a
// request of its own would be refused by the console for lacking its state.

const NO_LINK = 'Return to the application you were signing in to';

function newTenant(verifyEmail = false): {
  tenant: string;
  username: string;
  email: string;
  password: string;
} {
  const tag = randomBytes(4).toString('hex');
  const tenant = `resume-${tag}`;
  const username = 'ada';
  const password = randomPassword();
  seed(['tenant', '--name', tenant]);
  seed([
    'tenant',
    '--name',
    tenant,
    '--set',
    'reset_password_allowed=true',
    '--set',
    'registration_allowed=true',
    '--set',
    `verify_email=${String(verifyEmail)}`,
  ]);
  seed([
    'user',
    '--tenant',
    tenant,
    '--username',
    username,
    `--password=${password}`,
    '--email',
    `ada-${tag}@example.test`,
  ]);
  seed([
    'grant-role',
    '--tenant',
    tenant,
    '--username',
    username,
    '--role',
    'odudu-admin:tenant-admin',
  ]);
  return { tenant, username, email: `ada-${tag}@example.test`, password };
}

function mailedKey(tenant: string, to: string): string {
  return psql(
    `select substring(o.body_text from 'key=([A-Za-z0-9_%.-]+)') from email_outbox o where o.tenant_id = ${inTenant(tenant)} and o.to_address = ${sqlText(to)} order by o.created_at desc limit 1`,
  );
}

const linkFor = (tenant: string, key: string): string =>
  `/tenants/${tenant}/login-actions/action-token?key=${key}`;

async function expectConsole(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Sign-in failed')).toBeHidden();
}

async function askForReset(page: Page, tenant: string, email: string): Promise<string> {
  await page.goto(`/console/${tenant}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  return mailedKey(tenant, email);
}

async function resetThrough(page: Page, tenant: string, key: string, password: string) {
  await page.goto(linkFor(tenant, key));
  await page.getByLabel('New password').fill(password);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your password has been reset' }),
  ).toBeVisible();
}

test('a reset mailed from the console sign-in, opened in the same browser, signs in to the console', async ({
  page,
}) => {
  const { tenant, username, email } = newTenant();
  const key = await askForReset(page, tenant, email);

  const reset = randomPassword();
  await resetThrough(page, tenant, key, reset);
  await page.getByRole('link', { name: 'Continue to sign in' }).click();

  await signInAtTenant(page, { tenant, username, password: reset });
  await expectConsole(page);
});

test('a verification mailed from the console registration, opened in the same browser, signs in to the console', async ({
  page,
}) => {
  const { tenant } = newTenant(true);
  const username = 'grace';
  const email = `grace-${tenant}@example.test`;
  const password = randomPassword();

  await page.goto(`/console/${tenant}`);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await page.goto(linkFor(tenant, mailedKey(tenant, email)));
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your account is ready' }),
  ).toBeVisible();
  // The account exists only now, so it is granted the console's role now.
  seed([
    'grant-role',
    '--tenant',
    tenant,
    '--username',
    username,
    '--role',
    'odudu-admin:tenant-admin',
  ]);
  await page.getByRole('link', { name: 'Continue to sign in' }).click();

  await signInAtTenant(page, { tenant, username, password });
  await expectConsole(page);
});

test('the same link opened in a different browser offers no way to sign in, and says what to do', async ({
  page,
  browser,
}) => {
  const { tenant, email } = newTenant();
  const key = await askForReset(page, tenant, email);

  const elsewhere = await browser.newContext({ baseURL: BASE });
  try {
    const other = await elsewhere.newPage();
    await resetThrough(other, tenant, key, randomPassword());
    await expect(other.getByRole('link', { name: 'Continue to sign in' })).toBeHidden();
    await expect(other.getByRole('link')).toHaveCount(0);
    await expect(other.getByText(NO_LINK)).toBeVisible();
  } finally {
    await elsewhere.close();
  }
});

test('once the sign-in it came from has lapsed, the link offers no way to sign in', async ({
  page,
}) => {
  const { tenant, email } = newTenant();
  await page.goto(`/console/${tenant}`);
  const parked = await page.locator('input[name="auth_session_id"]').first().inputValue();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();

  psql(
    `update authentication_sessions set expires_at = now() - interval '1 second' where id = ${sqlText(parked)}`,
  );
  await resetThrough(page, tenant, mailedKey(tenant, email), randomPassword());
  await expect(page.getByRole('link', { name: 'Continue to sign in' })).toBeHidden();
  await expect(page.getByText(NO_LINK)).toBeVisible();
});
