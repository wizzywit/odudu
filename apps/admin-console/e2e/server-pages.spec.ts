import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { expect, forgive, test } from './fixtures';
import { authorize, client, LANDING, LONG_NAME, mailKey, ROOT, totp } from './page-flows';
import { BASE, COMMON_PASSWORD, forgiveRefusals, inspect } from './page-inspection';
import { inTenant, psql, seed } from './stack';
import type { Page } from '@playwright/test';
import { randomPassword } from './password';

// Every page the server renders, reached the way a person reaches it, held to
// axe in both themes, to the phone's width, and to one card width. With
// PAGE_SHOTS_DIR set it also saves each page in both themes at three widths.

const run = randomBytes(3).toString('hex');
const PASSWORD = randomPassword('Visual-');
// Every scope the consent clients are assigned, so the page lists defaults and options.
const ALL_SCOPES = [
  'openid',
  'profile',
  'reports',
  'email',
  'offline_access',
  'segment'.repeat(12),
].join(' ');
const LONG_SCOPE_TEXT =
  'Read every report your organisation has ever produced, including the confidential quarterly summaries and the attachments beneath them, for as long as you remain employed';

const main = `pages-${run}`;
const otp = `pages-otp-${run}`;
const open = `pages-open-${run}`;

async function signIn(page: Page, username: string, password = PASSWORD): Promise<void> {
  await page.getByLabel(/^Username/u).fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  seed(['tenant', '--name', main]);
  for (const username of ['alice', 'forced', 'passkey', 'recovery']) {
    seed([
      'user',
      '--tenant',
      main,
      '--username',
      username,
      `--password=${PASSWORD}`,
      ...(username === 'forced' ? ['--require-password-change'] : []),
    ]);
  }
  psql(
    `insert into user_required_actions (tenant_id, subject_id, action) select u.tenant_id, u.subject_id, 'configure-passkey' from users u where u.tenant_id = ${inTenant(main)} and u.username = 'passkey'`,
  );
  psql(
    `insert into user_required_actions (tenant_id, subject_id, action) select u.tenant_id, u.subject_id, 'generate-recovery-codes' from users u where u.tenant_id = ${inTenant(main)} and u.username = 'recovery'`,
  );
  client(main, 'portal', 'Acme Reporting Portal');
  client(main, 'longco', LONG_NAME);
  client(main, 'plain', 'Plain application');
  psql(
    `update client_oidc_config set consent_required = true, client_uri = '${BASE}/about', policy_uri = '${BASE}/privacy', tos_uri = '${BASE}/terms' where client_id in (select id from clients where tenant_id = ${inTenant(main)} and client_id in ('portal', 'longco'))`,
  );
  psql(
    `update client_oidc_config set frontchannel_logout_uri = '${LANDING}', post_logout_redirect_uris = '{${LANDING}}' where client_id in (select id from clients where tenant_id = ${inTenant(main)} and client_id = 'plain')`,
  );
  seed(['scope', '--tenant', main, '--name', 'reports', '--description', LONG_SCOPE_TEXT]);
  seed([
    'scope',
    '--tenant',
    main,
    '--name',
    'segment'.repeat(12),
    '--description',
    'unbroken'.repeat(14),
  ]);
  for (const id of ['portal', 'longco']) {
    for (const [scope, assignment] of [
      ['profile', 'default'],
      ['reports', 'default'],
      ['email', 'optional'],
      ['offline_access', 'optional'],
      ['segment'.repeat(12), 'optional'],
    ] as const) {
      seed([
        'assign-scope',
        '--tenant',
        main,
        '--client-id',
        id,
        '--scope',
        scope,
        '--assignment',
        assignment,
      ]);
    }
  }

  seed(['tenant', '--name', otp, '--set', 'otp_required=true']);
  client(otp, 'otpapp', 'Authenticator demo');
  seed(['user', '--tenant', otp, '--username', 'bob', `--password=${PASSWORD}`]);

  seed(['tenant', '--name', open]);
  seed([
    'tenant',
    '--name',
    open,
    '--set',
    'registration_allowed=true',
    '--set',
    'verify_email=true',
    '--set',
    'reset_password_allowed=true',
  ]);
  client(open, 'openapp', 'Open application');
  seed([
    'user',
    '--tenant',
    open,
    '--username',
    'unverified',
    `--password=${PASSWORD}`,
    '--email',
    `unverified-${run}@example.test`,
  ]);
  seed([
    'user',
    '--tenant',
    open,
    '--username',
    'resetter',
    `--password=${PASSWORD}`,
    '--email',
    `resetter-${run}@example.test`,
  ]);
});

test('the sign-in form, its refusal and the second-factor pages', async ({ page }) => {
  await page.goto(authorize(main, 'portal'));
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('to continue to Acme Reporting Portal')).toBeVisible();
  await expect(page.locator('.tenant')).toHaveText(main);
  await inspect(page, 'signin-empty');

  await signIn(page, 'alice', 'not the password');
  await expect(page.getByRole('alert')).toContainText('Sign-in failed');
  await expect(page.getByLabel('Username')).toHaveValue('alice');
  await expect(page.getByText('to continue to Acme Reporting Portal')).toBeVisible();
  await inspect(page, 'signin-error-echo');

  await page.goto(authorize(otp, 'otpapp'));
  await signIn(page, 'bob');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Set up your authenticator' }),
  ).toBeVisible();
  await page.getByLabel('Code from your app').fill('000000');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const secret = (await page.getByText('Key:').locator('code').innerText()).trim();
  await inspect(page, 'totp-enrolment');

  await page.getByLabel('Code from your app').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Save your recovery codes' }),
  ).toBeVisible();
  await inspect(page, 'recovery-codes');
  await page.getByRole('button', { name: 'I have saved these codes' }).click();
  await expect(page).toHaveURL(/\/health\/ready/u);

  await page.goto(authorize(otp, 'otpapp', { prompt: 'login' }));
  await signIn(page, 'bob');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Enter your authentication code' }),
  ).toBeVisible();
  await inspect(page, 'second-factor-totp');
  await page.getByLabel('Code from your app').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toContainText('That code did not work');
  await inspect(page, 'second-factor-totp-error');
});

test('the required-action pages: password change, passkey enrolment', async ({
  page,
  problems,
}) => {
  await page.goto(authorize(main, 'plain'));
  await signIn(page, 'forced');
  await expect(page.getByRole('heading', { level: 1, name: 'Change your password' })).toBeVisible();
  await inspect(page, 'update-password');
  await page.getByLabel('New password').fill(COMMON_PASSWORD);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('alert')).toContainText('That password is too easy to guess.');
  await inspect(page, 'update-password-violations');

  await page.goto(authorize(main, 'plain', { prompt: 'login' }));
  await signIn(page, 'passkey');
  await expect(page.getByRole('heading', { level: 1, name: 'Add a passkey' })).toBeVisible();
  await inspect(page, 'passkey-enrolment');
  forgiveRefusals(problems);
});

test('consent, the account chooser and signing out', async ({ page, problems }) => {
  await page.goto(authorize(main, 'portal', { scope: ALL_SCOPES }));
  await signIn(page, 'alice');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('is asking for access');
  await inspect(page, 'consent');

  await page.goto(authorize(main, 'longco', { prompt: 'login', scope: ALL_SCOPES }));
  await signIn(page, 'alice');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(LONG_NAME);
  await inspect(page, 'consent-long-names');
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page).toHaveURL(/\/health\/ready/u);

  await page.goto(authorize(main, 'plain', { prompt: 'select_account' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Choose an account' })).toBeVisible();
  await inspect(page, 'select-account');

  await page.goto(`/tenants/${main}/protocol/openid-connect/logout?client_id=plain`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign out?' })).toBeVisible();
  await inspect(page, 'logout-confirm');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Signed out' })).toBeVisible();
  await inspect(page, 'logout-done');

  await page.goto(authorize(main, 'plain', { prompt: 'login' }));
  await signIn(page, 'alice');
  await expect(page).toHaveURL(/\/health\/ready/u);
  const unregistered = encodeURIComponent('https://unregistered.example/');
  await page.goto(
    `/tenants/${main}/protocol/openid-connect/logout?client_id=plain&post_logout_redirect_uri=${unregistered}`,
  );
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('has not been used')).toBeVisible();
  await inspect(page, 'logout-redirect-refused');

  await page.goto(`/tenants/${main}/protocol/openid-connect/logout`);
  await expect(page.getByRole('heading', { level: 1, name: 'Already signed out' })).toBeVisible();
  await inspect(page, 'logout-no-session');

  await page.goto(authorize(main, 'plain', { prompt: 'login' }));
  await signIn(page, 'alice');
  await expect(page).toHaveURL(/\/health\/ready/u);
  await page.goto(`/tenants/${main}/protocol/openid-connect/logout?client_id=plain`);
  await page.locator('input[name="csrf"]').evaluate((input: HTMLInputElement) => {
    input.value = 'forged';
  });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Can't sign out" })).toBeVisible();
  await inspect(page, 'logout-unauthenticated');
  forgiveRefusals(problems);
});

test('the error pages', async ({ page, problems }) => {
  await page.goto(authorize(main, 'portal', { redirect_uri: 'https://nowhere.example/cb' }));
  await expect(page.getByRole('heading', { level: 1, name: "Can't continue" })).toBeVisible();
  await inspect(page, 'error');

  // The first refusal restarts the sign-in once; the one inside that minute is shown.
  await page.goto('/console/auth/callback?code=forged&state=forged');
  await page.goto('/console/auth/callback?code=forged&state=forged');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign-in failed' })).toBeVisible();
  await inspect(page, 'console-refusal');
  forgiveRefusals(problems);
});

test('the password hints are a plain list, and a script ticks them and shows the password', async ({
  page,
  browser,
  problems,
}) => {
  await page.goto(`/tenants/${open}/login-actions/registration`);
  const rules = page.locator('#password-rules');
  await expect(rules.getByRole('listitem')).toHaveText([
    'At least 15 characters',
    'Not a common password',
  ]);
  const field = page.getByLabel('Password', { exact: true });
  const again = page.getByLabel('Confirm password');
  await expect(again).toHaveAttribute('autocomplete', 'new-password');
  await expect(field).toHaveAttribute('autocomplete', 'new-password');
  await expect(field).toHaveAttribute('minlength', '15');
  const length = rules.locator('li[data-rule="length"]');
  const toggle = rules.getByRole('button', { name: 'Show password' });
  await expect(toggle).toBeVisible();
  await expect(length).toHaveAttribute('data-met', 'false');
  await field.fill('short');
  await expect(length).toHaveAttribute('data-met', 'false');
  await inspect(page, 'registration-hints-unmet');

  await field.fill('a long enough passphrase');
  await expect(length).toHaveAttribute('data-met', 'true');
  await expect(rules.getByRole('status')).toHaveText('1 of 1 rules met');
  await toggle.click();
  await expect(field).toHaveAttribute('type', 'text');
  await expect(again).toHaveAttribute('type', 'text');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveText('Show password');
  await inspect(page, 'registration-hints-met-shown');
  await toggle.click();
  await expect(field).toHaveAttribute('type', 'password');
  await expect(again).toHaveAttribute('type', 'password');
  const withScript = await rules.boundingBox();
  expect(problems).toEqual([]);

  // Without a script the same list is there, the toggle is not, and nothing moves.
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const bare = await plain.newPage();
  await bare.goto(`${BASE}/tenants/${open}/login-actions/registration`);
  await expect(bare.locator('#password-rules').getByRole('listitem')).toHaveText([
    'At least 15 characters',
    'Not a common password',
  ]);
  await expect(bare.locator('#password-rules button')).toBeHidden();
  const withoutScript = await bare.locator('#password-rules').boundingBox();
  expect(withoutScript?.height).toBe(withScript?.height);
  await plain.close();
});

test('prompt=create lands on the registration page, with the way back to the sign-in', async ({
  page,
}) => {
  await page.goto(authorize(open, 'openapp', { prompt: 'create' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Create account' })).toBeVisible();
  expect(page.url()).toContain(`/tenants/${open}/login-actions/registration?return_to=`);
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('to continue to')).toContainText('Open application');
});

test('registration, the unverified account, password reset and their links', async ({
  page,
  problems,
}) => {
  // The sign-in page offers the two pages this tenant serves, and the way
  // on from each leads back to the same request.
  await page.goto(authorize(open, 'openapp'));
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
  await inspect(page, 'signin-links');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
  await inspect(page, 'registration');

  // Nothing filled in: each empty field says so, in place, and the first has focus.
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create account' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Enter a username.');
  await expect(page.getByLabel('Username')).toBeFocused();
  await expect(page.getByLabel('Username')).toHaveAttribute('aria-invalid', 'true');
  await inspect(page, 'registration-required');

  await page.getByLabel('Username').fill('newcomer');
  await page.getByLabel('Email').fill(`newcomer-${run}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(COMMON_PASSWORD);
  await page.getByLabel('Confirm password').fill(COMMON_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('That password is too easy to guess.');
  await expect(page.getByLabel('Username')).toHaveValue('newcomer');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Confirm password')).toHaveValue('');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
  await inspect(page, 'registration-weak');

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill('another one');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText("The passwords don't match.");
  await expect(page.getByLabel('Confirm password')).toBeFocused();
  await inspect(page, 'registration-mismatch');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
  await inspect(page, 'registration-succeeded');

  const key = mailKey(open, `newcomer-${run}@example.test`);
  // Opening the link only asks; the button is what creates the account.
  await page.goto(`/tenants/${open}/login-actions/action-token?key=${key}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Confirm your email address' }),
  ).toBeVisible();
  await expect(page.getByText('Account name: newcomer')).toBeVisible();
  await inspect(page, 'confirm-register');
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your account is ready' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue to sign in' })).toBeVisible();
  await inspect(page, 'registration-ready');
  await page.goto(`/tenants/${open}/login-actions/action-token?key=${key}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText("can't be used");
  // A registration link is gone once opened, so it names no sign-in to go back to.
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveCount(0);
  await inspect(page, 'verification-failed');

  // Once the link has made the account, its name is taken.
  await page.goto(`/tenants/${open}/login-actions/registration`);
  await page.getByLabel('Username').fill('newcomer');
  await page.getByLabel('Email').fill(`other-${run}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('That username is already taken.');
  await expect(page.getByLabel('Email')).toHaveValue(`other-${run}@example.test`);
  await inspect(page, 'registration-taken');

  await page.goto(authorize(open, 'openapp'));
  await signIn(page, 'unverified');
  await expect(page.getByRole('heading', { level: 1, name: "Can't sign in yet" })).toBeVisible();
  await page.getByRole('link', { name: 'Back to sign in' }).waitFor();
  await inspect(page, 'email-unverified');
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Forgot your password?' }),
  ).toBeVisible();
  await inspect(page, 'reset-request');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('alert')).toContainText('Email is required.');
  await expect(page.getByLabel('Email')).toBeFocused();
  await inspect(page, 'reset-request-failed');
  await page.getByLabel('Email').fill(`resetter-${run}@example.test`);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
  await inspect(page, 'reset-sent');

  const reset = mailKey(open, `resetter-${run}@example.test`);
  await page.goto(`/tenants/${open}/login-actions/action-token?key=${reset}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Choose a new password' }),
  ).toBeVisible();
  await inspect(page, 'reset-new-password');
  await page.getByLabel('New password').fill(COMMON_PASSWORD);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Choose a new password' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('That password is too easy to guess.');
  await expect(page.getByLabel('New password')).toBeFocused();
  await inspect(page, 'reset-weak');
  await page.getByLabel('New password').fill(`${PASSWORD}-reset`);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your password has been reset' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue to sign in' })).toBeVisible();
  await inspect(page, 'reset-done');
  await page.goto(`/tenants/${open}/login-actions/action-token?key=${reset}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText("can't be used");
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
  await inspect(page, 'reset-link-failed');

  // A visit that carries no request has nothing to go back to: the same pages
  // say what to do instead, and show no link.
  await page.goto(`/tenants/${open}/login-actions/registration`);
  await page.getByLabel('Username').fill('direct');
  await page.getByLabel('Email').fill(`direct-${run}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  const direct = mailKey(open, `direct-${run}@example.test`);
  await page.goto(`/tenants/${open}/login-actions/action-token?key=${direct}`);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('account is ready');
  await expect(page.getByText('Return to the application you were signing in to')).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(0);
  await inspect(page, 'verification-ok-direct');

  await page.goto(`/tenants/${open}/login-actions/reset-password`);
  await page.getByLabel('Email').fill(`resetter-${run}@example.test`);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  const again = mailKey(open, `resetter-${run}@example.test`);
  await page.goto(`/tenants/${open}/login-actions/action-token?key=${again}`);
  await page.getByLabel('New password').fill(`${PASSWORD}-direct`);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByText('Return to the application you were signing in to')).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(0);
  await inspect(page, 'reset-done-direct');
  forgiveRefusals(problems);
});

test('an address nothing serves', async ({ page, problems }) => {
  // A browser's own navigation, so the server sees the Accept it sends.
  const missing = await page.goto('/nope');
  expect(missing?.status()).toBe(404);
  expect(missing?.headers()['cache-control']).toBe('no-store');
  expect(missing?.headers().vary).toContain('Accept');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read the documentation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the console' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('nope');
  const animation = (selector: string): Promise<string> =>
    page.locator(selector).evaluate((element) => getComputedStyle(element).animationName);
  // The run's default is reduced motion: the final frame, nothing playing.
  expect(await animation('.lost-route-a')).toBe('none');
  expect(await animation('.lost-staff')).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await animation('.lost-route-a')).toBe('lost-draw-a');
  expect(await animation('.lost-badge')).toBe('lost-settle');
  expect(await animation('.lost-staff')).toBe('lost-lean');
  // A pointer over the drawing replays it from the start.
  await page.locator('svg.lost').hover();
  expect(await animation('.lost-route-a')).toBe('lost-draw-a-again');
  const elapsed = await page
    .locator('.lost-route-a')
    .evaluate((element) => Number(element.getAnimations()[0]?.currentTime ?? Number.NaN));
  expect(elapsed).toBeLessThan(1500);
  await page.mouse.move(0, 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('svg.lost').hover();
  expect(await animation('.lost-route-a')).toBe('none');
  await page.mouse.move(0, 0);
  await inspect(page, 'not-found');

  // The page a tenant that does not exist gets is this one, byte for byte.
  const unknownTenant = await page.request.get('/tenants/no-such-tenant/login-actions/nope', {
    headers: { accept: 'text/html' },
  });
  expect(unknownTenant.status()).toBe(404);
  expect(await unknownTenant.text()).toBe(await missing?.text());

  const program = await page.request.get('/nope', { headers: { accept: 'application/json' } });
  expect(program.headers()['content-type']).toContain('application/problem+json');
  expect(z.object({ detail: z.string() }).parse(await program.json()).detail).toBe(
    'No resource at this path',
  );
  forgiveRefusals(problems);
});

// A failure cannot be caused on a healthy stack, so this page is the renderer's
// own output, served under the headers a real response carries.
const RENDER_SERVER_ERROR = `
const { renderServerErrorPage } = await import(process.env.RENDERER);
const { pageHeaders } = await import(process.env.HEADERS);
const page = renderServerErrorPage('01JEXAMPLEREQUESTID', { tag: 'en', dir: 'ltr' });
process.stdout.write(JSON.stringify({ html: page.html, headers: Object.fromEntries(pageHeaders(page)) }));
`;

test('the server-error page, renderer only', async ({ page, problems }) => {
  const rendered = z.object({ html: z.string(), headers: z.record(z.string(), z.string()) }).parse(
    JSON.parse(
      execFileSync('node', ['--no-warnings', '--input-type=module', '-e', RENDER_SERVER_ERROR], {
        encoding: 'utf8',
        env: {
          ...process.env,
          RENDERER: pathToFileURL(
            path.join(ROOT, 'packages/protocol-oidc/src/view/server-error-html.ts'),
          ).href,
          HEADERS: pathToFileURL(path.join(ROOT, 'packages/kernel/src/page.ts')).href,
        },
      }),
    ),
  );
  const view = `${BASE}/server-error-view`;
  await page.route(view, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'text/html',
      headers: rendered.headers,
      body: rendered.html,
    }),
  );
  await page.goto(view);
  await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByText('Request ID: 01JEXAMPLEREQUESTID')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const selector of ['.lost-route-a', '.lost-route-b', '.lost-badge', '.lost-staff']) {
    expect(
      await page.locator(selector).evaluate((element) => getComputedStyle(element).animationName),
      selector,
    ).toBe('none');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await inspect(page, 'server-error');
  forgive(problems, '/server-error-view');
});

// An administrator's actions link opens with no request behind it, and the
// stack cannot mint one here, so the page is the renderer's own output under
// the headers a real response carries: once with no way back, once with one.
const RENDER_ACTIONS_DONE = `
const { renderRequiredActionsSucceededPage } = await import(process.env.RENDERER);
const { pageHeaders } = await import(process.env.HEADERS);
const page = renderRequiredActionsSucceededPage([], process.env.WAY || null, { tag: 'en', dir: 'ltr' });
process.stdout.write(JSON.stringify({ html: page.html, headers: Object.fromEntries(pageHeaders(page)) }));
`;

test('the actions-done page, with and without a way back, renderer only', async ({ page }) => {
  for (const [way, name, expected] of [
    ['', 'actions-done-direct', 'Return to the application you were signing in to'],
    [
      '/tenants/demo/protocol/openid-connect/auth?client_id=app',
      'actions-done',
      'Continue to sign in',
    ],
  ] as const) {
    const rendered = z
      .object({ html: z.string(), headers: z.record(z.string(), z.string()) })
      .parse(
        JSON.parse(
          execFileSync(
            'node',
            ['--no-warnings', '--input-type=module', '-e', RENDER_ACTIONS_DONE],
            {
              encoding: 'utf8',
              env: {
                ...process.env,
                WAY: way,
                RENDERER: pathToFileURL(
                  path.join(ROOT, 'packages/account/src/view/required-actions-html.ts'),
                ).href,
                HEADERS: pathToFileURL(path.join(ROOT, 'packages/kernel/src/page.ts')).href,
              },
            },
          ),
        ),
      );
    const view = `${BASE}/actions-done-view-${name}`;
    await page.route(view, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: rendered.headers,
        body: rendered.html,
      }),
    );
    await page.goto(view);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your account is updated' }),
    ).toBeVisible();
    await expect(page.getByText(expected)).toBeVisible();
    await expect(page.getByRole('link')).toHaveCount(way === '' ? 0 : 1);
    await inspect(page, name);
  }
});
