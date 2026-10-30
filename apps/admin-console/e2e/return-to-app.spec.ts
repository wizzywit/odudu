import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { expect, test } from './fixtures';
import { BASE, COMMON_PASSWORD, forgiveRefusals } from './page-inspection';
import { inTenant, psql, seed, sqlText } from './stack';
import type { Page } from '@playwright/test';
import { randomPassword } from './password';

// An application starts /authorize with a state of its own; the person goes
// to create an account or reset a password and comes back through the page's
// own link, signs in, and the browser lands on the application's redirect_uri
// with the same state and a code that exchanges.

const tag = randomBytes(4).toString('hex');
const REDIRECT = `${BASE}/health/ready`;
const PASSWORD = randomPassword('Return-');
const VERIFIER = Buffer.concat([randomBytes(32), Buffer.from(tag)]).toString('base64url');
const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');
const name = `return-${tag}`;
const STATE = `app-state-${tag}`;
const NONCE = `nonce-${tag}`;

function authorizeUrl(state: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'app',
    redirect_uri: REDIRECT,
    scope: 'openid',
    state,
    nonce: NONCE,
    code_challenge: pkceChallenge(VERIFIER),
    code_challenge_method: 'S256',
  });
  return `/tenants/${name}/protocol/openid-connect/auth?${query.toString()}`;
}

function mailQuery(to: string): string {
  return psql(
    `select substring(o.body_text from 'key=([A-Za-z0-9_%.&=-]+)') from email_outbox o where o.tenant_id = ${inTenant(name)} and o.to_address = ${sqlText(to)} order by o.created_at desc limit 1`,
  );
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  seed(['tenant', '--name', name]);
  seed([
    'tenant',
    '--name',
    name,
    '--set',
    'registration_allowed=true',
    '--set',
    'reset_password_allowed=true',
  ]);
  seed(['client', '--tenant', name, '--client-id', 'app', '--public', '--redirect-uri', REDIRECT]);
  seed([
    'user',
    '--tenant',
    name,
    '--username',
    'resetter',
    `--password=${PASSWORD}`,
    '--email',
    `resetter-${tag}@example.test`,
  ]);
});

// The browser lands on the application's address with a code and the state;
// the code exchanges for tokens with the verifier whose hash was the challenge.
async function landed(page: Page, state: string): Promise<void> {
  await page.waitForURL(/\/health\/ready\?/u);
  const url = new URL(page.url());
  expect(url.searchParams.get('state')).toBe(state);
  const code = url.searchParams.get('code');
  expect(code).not.toBeNull();
  const exchanged = await page.request.post(`/tenants/${name}/protocol/openid-connect/token`, {
    form: {
      grant_type: 'authorization_code',
      code: code ?? '',
      redirect_uri: REDIRECT,
      client_id: 'app',
      code_verifier: VERIFIER,
    },
  });
  expect(exchanged.status()).toBe(200);
  const tokens = z
    .object({ access_token: z.string(), id_token: z.string() })
    .parse(await exchanged.json());
  expect(tokens.access_token).not.toBe('');
  // The application's own nonce, which an application checks before it trusts the token.
  const claims = z
    .object({ nonce: z.string() })
    .parse(JSON.parse(Buffer.from(tokens.id_token.split('.')[1] ?? '', 'base64url').toString()));
  expect(claims.nonce).toBe(NONCE);
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByLabel(/^Username/u).fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('registering, after a refused first attempt, and coming back to the application', async ({
  page,
  problems,
}) => {
  await page.goto(authorizeUrl(STATE));
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create account' })).toBeVisible();

  // The refusal comes back as the same form, and the way back is still on it.
  await page.getByLabel('Username').fill(`new-${tag}`);
  await page.getByLabel('Email').fill(`new-${tag}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(COMMON_PASSWORD);
  await page.getByLabel('Confirm password').fill(COMMON_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('That password is too easy to guess.');
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Account created' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to sign in' }).click();

  await signIn(page, `new-${tag}`, PASSWORD);
  await landed(page, STATE);
  forgiveRefusals(problems);
});

test('resetting, after a refused first attempt, and coming back to the application', async ({
  page,
  problems,
}) => {
  await page.goto(authorizeUrl(STATE));
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Forgot your password?' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('alert')).toContainText('Email is required.');
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();

  await page.getByLabel('Email').fill(`resetter-${tag}@example.test`);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();

  // Back from the page that answered: the same request, so the same state.
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await signIn(page, 'resetter', PASSWORD);
  await landed(page, STATE);
  forgiveRefusals(problems);
});

test('the mailed reset link, opened in the same browser, resumes the original request: its state and nonce', async ({
  page,
  problems,
}) => {
  await page.goto(authorizeUrl(STATE));
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(`resetter-${tag}@example.test`);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();

  // Nothing of the request travels in the mail.
  const query = mailQuery(`resetter-${tag}@example.test`);
  expect(query).not.toContain('state');
  expect(query).not.toContain('nonce');
  expect(query).not.toContain('return_to');
  await page.goto(`/tenants/${name}/login-actions/action-token?key=${query}`);
  await page.getByLabel('New password').fill(COMMON_PASSWORD);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('alert')).toContainText('That password is too easy to guess.');
  const reset = `${PASSWORD}-reset`;
  await page.getByLabel('New password').fill(reset);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your password has been reset' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Continue to sign in' }).click();

  // The same request again, so the application's own state and nonce come back.
  await signIn(page, 'resetter', reset);
  await landed(page, STATE);
  forgiveRefusals(problems);
});

test('the same mailed link in another browser offers no way to sign in', async ({
  page,
  browser,
}) => {
  await page.goto(authorizeUrl(STATE));
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(`resetter-${tag}@example.test`);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  const query = mailQuery(`resetter-${tag}@example.test`);

  const elsewhere = await browser.newContext({ baseURL: BASE });
  try {
    const other = await elsewhere.newPage();
    await other.goto(`/tenants/${name}/login-actions/action-token?key=${query}`);
    await other.getByLabel('New password').fill(`${PASSWORD}-other`);
    await other.getByRole('button', { name: 'Reset password' }).click();
    await expect(
      other.getByRole('heading', { level: 1, name: 'Your password has been reset' }),
    ).toBeVisible();
    await expect(other.getByRole('link')).toHaveCount(0);
    await expect(other.getByText('Return to the application you were signing in to')).toBeVisible();
  } finally {
    await elsewhere.close();
  }
});
