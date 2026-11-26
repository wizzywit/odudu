import type { Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectFitsViewport,
  forgive,
  signIn,
  test,
  tabsWithin,
  PHONE,
} from './fixtures';
import { psql, seeded } from './stack';

const { settings } = seeded().config;
const { system } = seeded();

function column(tenant: string, name: string): string {
  return psql(`select ${name} from tenants where name = '${tenant}'`);
}

const tabTo = tabsWithin(250);

async function openSettings(page: Page, tenant: string): Promise<void> {
  await page.goto(`/console/${tenant}/settings`);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'General' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
}

function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

async function type(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press('Tab');
}

test('sessions, the password policy and the recorded events are saved, each on its own', async ({
  page,
  problems,
}) => {
  test.slow();
  const { main } = settings;
  await signIn(page, main);
  await openSettings(page, main.tenant);
  await expectAccessible(page);

  const sessions = region(page, 'Sessions');
  const idle = sessions.getByRole('textbox', { name: 'Idle timeout' });
  await expect(sessions.getByRole('button', { name: /Idle timeout, unit/u })).toContainText('min');
  await type(idle, '60');
  await expect(idle).toHaveValue('60');
  await expectAccessible(page);
  await sessions.getByRole('button', { name: 'Save Sessions' }).click();
  await expect(sessions.getByRole('button', { name: 'Save Sessions' })).toBeHidden();
  await expect.poll(() => column(main.tenant, 'sso_session_idle_seconds')).toBe('3600');

  const password = region(page, 'Password policy');
  await type(password.getByRole('textbox', { name: 'Minimum length' }), '12');
  await expect(password.getByRole('note')).toContainText('A minimum under 15 is only safe');
  await expectAccessible(page);
  await password.getByText('Require a digit', { exact: true }).click();
  await password.getByRole('button', { name: 'Save Password policy' }).click();
  await expect(password.getByRole('button', { name: 'Save Password policy' })).toBeHidden();
  await expect.poll(() => column(main.tenant, 'password_min_length')).toBe('12');
  expect(column(main.tenant, 'password_require_digit')).toBe('t');

  const audit = region(page, 'Audit retention');
  await expect(audit.getByRole('checkbox', { name: /Changes by administrators/u })).toBeDisabled();
  await audit.getByText('Tokens issued and revoked').click();
  await expectAccessible(page);
  await audit.getByRole('button', { name: 'Save Audit retention' }).click();
  await expect(audit.getByRole('button', { name: 'Save Audit retention' })).toBeHidden();
  await expect
    .poll(() => column(main.tenant, `array_to_string(audit_event_types, ',')`))
    .toBe('admin_mutation,admin_access,authentication,session,credential');

  await page.reload();
  await expect(region(page, 'Sessions').getByRole('textbox', { name: 'Idle timeout' })).toHaveValue(
    '1',
  );
  await expect(
    region(page, 'Sessions').getByRole('button', { name: /Idle timeout, unit/u }),
  ).toContainText('h');
  await expect(
    region(page, 'Audit retention').getByRole('checkbox', { name: /Tokens issued/u }),
  ).not.toBeChecked();

  // An idle lifetime past the maximum is the server's to refuse, and it names the field.
  await region(page, 'Sessions')
    .getByRole('button', { name: /Idle timeout, unit/u })
    .click();
  await page.getByRole('option', { name: 's', exact: true }).click();
  await type(region(page, 'Sessions').getByRole('textbox', { name: 'Idle timeout' }), '99999999');
  await region(page, 'Sessions').getByRole('button', { name: 'Save Sessions' }).click();
  await expect(region(page, 'Sessions').getByText(/must not exceed/u)).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/tenants/${main.tenant}/settings`);
  expect(column(main.tenant, 'sso_session_idle_seconds')).toBe('3600');
});

test('a save in one section leaves another section’s edit able to save on the new ETag', async ({
  page,
}) => {
  const { rebase } = settings;
  await signIn(page, rebase);
  await openSettings(page, rebase.tenant);
  const usernames = region(page, 'Usernames');
  await usernames.getByText('Usernames can be renamed', { exact: true }).click();
  const registration = region(page, 'Registration and recovery');
  await registration.getByText('Verify email addresses', { exact: true }).click();
  await registration.getByRole('button', { name: 'Save Registration and recovery' }).click();
  await expect(
    registration.getByRole('button', { name: 'Save Registration and recovery' }),
  ).toBeHidden();
  await expect.poll(() => column(rebase.tenant, 'verify_email')).toBe('t');

  await expect(usernames.getByRole('switch', { name: /can be renamed/u })).toBeChecked();
  await usernames.getByRole('button', { name: 'Save Usernames' }).click();
  await expect(usernames.getByRole('button', { name: 'Save Usernames' })).toBeHidden();
  await expect.poll(() => column(rebase.tenant, 'username_editable')).toBe('t');
  expect(column(rebase.tenant, 'verify_email')).toBe('t');
  await expectAccessible(page);
});

test('settings changed behind the open page are shown beside the edit, and kept or taken', async ({
  page,
  problems,
}) => {
  const { behind } = settings;
  await signIn(page, behind);
  await openSettings(page, behind.tenant);
  const sessions = region(page, 'Sessions');
  await type(sessions.getByRole('textbox', { name: 'Idle timeout' }), '60');
  psql(`update tenants set sso_session_idle_seconds = 7200 where name = '${behind.tenant}'`);
  await sessions.getByRole('button', { name: 'Save Sessions' }).click();
  await expect(sessions.getByRole('button', { name: /Keep mine/u })).toBeVisible();
  await expect(sessions.getByText(/changed elsewhere/u).first()).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/tenants/${behind.tenant}/settings`);
  expect(column(behind.tenant, 'sso_session_idle_seconds')).toBe('7200');

  await sessions.getByRole('button', { name: /Keep mine/u }).click();
  await expect.poll(() => column(behind.tenant, 'sso_session_idle_seconds')).toBe('3600');
});

test('a switch is set and saved by keyboard alone', async ({ page }) => {
  test.slow();
  const { keyed } = settings;
  await signIn(page, keyed);
  await openSettings(page, keyed.tenant);
  const registration = region(page, 'Registration and recovery');
  const verify = registration.getByRole('switch', { name: 'Verify email addresses' });
  await tabTo(page, verify);
  await page.keyboard.press('Space');
  await expect(verify).toBeChecked();
  const save = registration.getByRole('button', { name: 'Save Registration and recovery' });
  await tabTo(page, save);
  await page.keyboard.press('Enter');
  await expect.poll(() => column(keyed.tenant, 'verify_email')).toBe('t');
  await expect(save).toBeHidden();
  await expectAccessible(page);
});

test('the username at registration is chosen, saved and kept after a reload', async ({ page }) => {
  const { username } = settings;
  await signIn(page, username);
  psql(
    `update tenants set login_with_email = true, verify_email = true where name = '${username.tenant}'`,
  );
  await openSettings(page, username.tenant);
  const registration = region(page, 'Registration and recovery');
  await registration.getByRole('button', { name: /Username at registration/u }).click();
  await page.getByRole('option', { name: 'Optional' }).click();
  await registration.getByRole('button', { name: 'Save Registration and recovery' }).click();
  await expect(
    registration.getByRole('button', { name: 'Save Registration and recovery' }),
  ).toBeHidden();
  await expect.poll(() => column(username.tenant, 'registration_username')).toBe('optional');

  await openSettings(page, username.tenant);
  await expect(
    region(page, 'Registration and recovery').getByRole('button', {
      name: /Username at registration/u,
    }),
  ).toContainText('Optional');
  await expectAccessible(page);
});

test('a display name is set, and cleared to use the tenant name', async ({ page }) => {
  const { general } = settings;
  await signIn(page, general);
  await openSettings(page, general.tenant);
  const section = region(page, 'General');
  await section.getByRole('textbox', { name: 'Display name' }).fill('Ohm Laboratories');
  await section.getByRole('button', { name: 'Save General' }).click();
  await expect(section.getByRole('button', { name: 'Save General' })).toBeHidden();
  await expect.poll(() => column(general.tenant, 'display_name')).toBe('Ohm Laboratories');
  await section.getByRole('textbox', { name: 'Display name' }).fill('');
  await section.getByRole('button', { name: 'Save General' }).click();
  await expect(section.getByRole('button', { name: 'Save General' })).toBeHidden();
  await expect.poll(() => column(general.tenant, 'display_name is null')).toBe('t');
});

test('disabling the tenant asks first, says who it locks out, and then does it', async ({
  page,
  problems,
}) => {
  test.slow();
  const { disable } = settings;
  await signIn(page, disable);
  await openSettings(page, disable.tenant);
  const section = region(page, 'General');
  await section.getByText('Enabled', { exact: true }).click();
  await section.getByRole('button', { name: 'Save General' }).click();
  const dialog = page.getByRole('alertdialog', { name: `Disable ${disable.tenant}?` });
  await expect(dialog).toContainText('Your own console session in');
  await expectAccessible(page);
  expect(column(disable.tenant, 'enabled')).toBe('t');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await section.getByRole('button', { name: 'Save General' }).click();
  await page
    .getByRole('textbox', { name: `Type ${disable.tenant} to confirm` })
    .fill(disable.tenant);
  await page.getByRole('button', { name: `Disable ${disable.tenant}` }).click();
  await expect.poll(() => column(disable.tenant, 'enabled')).toBe('f');
  forgive(problems, `/tenants/${disable.tenant}/settings`);
  forgive(problems, `/tenants/${disable.tenant}/whoami`);
  forgive(problems, '/console/api/session');
});

test('the system tenant’s Enabled switch is fixed, with the reason said', async ({ page }) => {
  await signIn(page, system);
  await openSettings(page, 'system');
  const section = region(page, 'General');
  await expect(section.getByRole('switch', { name: 'Enabled' })).toBeDisabled();
  await expect(section.getByText(/cannot be disabled/u)).toBeVisible();
  await expectAccessible(page);
});

test('an operator holding manage-clients alone is told what Settings needs, and has no link to it', async ({
  page,
}) => {
  const { fixed, fixedClientsOnly } = settings;
  await signIn(page, fixedClientsOnly);
  await page.goto(`/console/${fixed.tenant}/settings`);
  await expect(page.getByRole('note').filter({ hasText: 'Settings needs' })).toHaveText(
    'Settings needs the manage-tenant capability.',
  );
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save / })).toHaveCount(0);
  await expectAccessible(page);
});

test('a section is reached from the list at the top by keyboard alone, the focus landing on its heading', async ({
  page,
}) => {
  await signIn(page, settings.fixed);
  await openSettings(page, settings.fixed.tenant);
  const nav = page.getByRole('navigation', { name: 'On this page' });
  const target = nav.getByRole('link', { name: 'Brute force' });
  await tabTo(page, target);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Brute force' })).toBeFocused();
  await expectAccessible(page);
});

test('the settings page fits a phone', async ({ page }) => {
  test.slow();
  await page.setViewportSize(PHONE);
  await signIn(page, settings.fixed);
  await openSettings(page, settings.fixed.tenant);
  await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
  await expectFitsViewport(page, 'settings');
  await expectAccessible(page);
});
