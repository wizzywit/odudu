import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, forgive, signIn, signInAtTenant, test } from './fixtures.ts';
import { psql, seeded } from './stack.ts';

const { subjects } = seeded();
const { admin, viewer } = subjects;
const TENANT = admin.tenant;
const PHONE = { width: 390, height: 844 };

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function subjectId(username: string): string {
  return psql(
    `select u.subject_id from users u join tenants t on t.id = u.tenant_id where t.name = ${sqlText(TENANT)} and u.username = ${sqlText(username)}`,
  );
}

function userColumn(username: string, column: 'name' | 'email'): string {
  return psql(
    `select coalesce(u.${column}, '<null>') from users u join tenants t on t.id = u.tenant_id where t.name = ${sqlText(TENANT)} and u.username = ${sqlText(username)}`,
  );
}

async function openSubject(page: Page, username: string, tab?: 'credentials'): Promise<void> {
  const at = `/console/${TENANT}/subjects/${subjectId(username)}`;
  await page.goto(tab === undefined ? at : `${at}?tab=${tab}`);
  await expect(page.getByRole('heading', { level: 1, name: username })).toBeVisible();
}

async function takeSecret(dialog: Locator): Promise<string> {
  const secret = await dialog.locator('code').first().innerText();
  await dialog.getByText(/^I have stored the /u).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  return secret;
}

test('a subject is created from the list and lands on its record, in place of the creation page', async ({
  page,
}) => {
  const username = `${subjects.prefix}-1`;
  await signIn(page, admin);
  await page
    .getByRole('navigation', { name: `Areas of ${TENANT}` })
    .getByRole('link', { name: 'Subjects' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Subjects' })).toContainText(subjects.edited);
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Create a subject' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create a subject' })).toBeVisible();
  await page.getByRole('button', { name: 'Create subject' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Username', exact: true }),
  ).toHaveAccessibleDescription(/Enter a username/u);
  await expectAccessible(page);
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(username);
  await page.getByRole('button', { name: 'Create subject' }).click();

  await expect(page.getByRole('heading', { level: 1, name: username })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/console/${TENANT}/subjects/${subjectId(username)}`);
  await expectAccessible(page);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
});

test('a username is shown fixed, with the reason and a link to Settings, while renaming is off', async ({
  page,
}) => {
  await signIn(page, admin);
  await openSubject(page, subjects.edited);
  const reason = page.getByText(/username_editable setting is off/u);
  await expect(reason).toBeVisible();
  await expect(reason.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    `/console/${TENANT}/settings`,
  );
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveCount(0);
  await expectAccessible(page);
});

test('a profile edit refused with 412 shows theirs beside yours, and keeping mine saves it', async ({
  page,
  problems,
}) => {
  const username = subjects.conflict;
  await signIn(page, admin);
  await openSubject(page, username);
  await page.getByRole('textbox', { name: 'Full name' }).fill('Mine');
  psql(
    `update users set name = 'Theirs' where username = ${sqlText(username)} and tenant_id = (select id from tenants where name = ${sqlText(TENANT)})`,
  );
  await page.getByRole('button', { name: 'Save Name' }).click();
  const table = page.getByRole('table', { name: 'Changed in Name since you opened it' });
  await expect(table.getByRole('row', { name: /Full name/u })).toContainText('TheirsMine');
  await expectAccessible(page);
  forgive(problems, `/console/api/admin/tenants/${TENANT}/subjects/${subjectId(username)}/profile`);
  await page.getByRole('button', { name: 'Keep mine in Name' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Name' })).toBeFocused();
  await expect(table).toBeHidden();
  expect(userColumn(username, 'name')).toBe('Mine');
});

test('a one-time password is shown once, and signs the subject in to a forced change', async ({
  page,
  browser,
}) => {
  const { username } = subjects.issued;
  await signIn(page, admin);
  await openSubject(page, username, 'credentials');
  await expect(page.getByRole('heading', { level: 2, name: 'Password' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Issue a one-time password' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Issue ${username} a one-time password?` });
  await expect(confirm).toBeVisible();
  await expectAccessible(page);
  await confirm.getByRole('button', { name: 'Issue password' }).click();
  const dialog = page.getByRole('dialog', { name: `${username}'s one-time password` });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  const password = await takeSecret(dialog);

  expect(await page.content()).not.toContain(password);
  const stored = await page.evaluate(() =>
    [sessionStorage, localStorage]
      .flatMap((storage) => Object.keys(storage).map((key) => storage.getItem(key) ?? ''))
      .join('\n'),
  );
  expect(stored).not.toContain(password);
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Password' })).toBeVisible();
  expect(await page.content()).not.toContain(password);

  const theirs = await browser.newContext();
  const theirPage = await theirs.newPage();
  await theirPage.goto(`/console/${TENANT}`);
  await signInAtTenant(theirPage, { tenant: TENANT, username, password });
  await expect(
    theirPage.getByRole('heading', { level: 1, name: 'Change your password' }),
  ).toBeVisible();
  await theirs.close();
});

test('a lockout is shown and cleared', async ({ page }) => {
  const { username } = subjects.locked;
  const id = subjectId(username);
  psql(
    `insert into login_failures (tenant_id, subject_id, failure_count, first_failure_at, last_failure_at, locked_until) select tenant_id, subject_id, 6, now(), now(), now() + interval '1 hour' from users where subject_id = '${id}'`,
  );
  await signIn(page, admin);
  await openSubject(page, username, 'credentials');
  await expect(page.getByText(/Locked after 6 failed sign-ins/u)).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Clear the lockout' }).click();
  const dialog = page.getByRole('alertdialog', { name: `Clear ${username}’s lockout?` });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Clear lockout' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('No failed sign-ins on record.')).toBeVisible();
  expect(psql(`select count(*) from login_failures where subject_id = '${id}'`)).toBe('0');
  await expectAccessible(page);
});

test('an operator holding view-users alone sees a subject, and nothing to change it with', async ({
  page,
}) => {
  await signIn(page, viewer);
  await openSubject(page, subjects.edited);
  await expect(page.getByRole('textbox', { name: 'Full name' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeDisabled();
  await expect(page.getByRole('note')).toContainText('manage-users');
  await expect(page.getByRole('button', { name: /^(Disable|Delete) /u })).toHaveCount(0);
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Credentials' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Lockout' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Issue|Remove|Revoke|Clear the/u })).toHaveCount(0);
  await expectAccessible(page);

  await page.goto(`/console/${TENANT}/subjects`);
  await expect(page.getByRole('grid', { name: 'Subjects' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a subject' })).toHaveCount(0);
  await expectAccessible(page);
});

test('the list and a record work at 390 px', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/subjects`);
  await expect(page.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
  await expect(page.getByText(subjects.edited, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    PHONE.width,
  );
  await expectAccessible(page);
  await openSubject(page, subjects.edited);
  await expect(page.getByRole('textbox', { name: 'Full name' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    PHONE.width,
  );
  await expectAccessible(page);
  await page.getByRole('tab', { name: 'Credentials' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Lockout' })).toBeVisible();
  await expectAccessible(page);
});

test('a subject is created by keyboard alone', async ({ page }) => {
  const username = `${subjects.prefix}-2`;
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/subjects`);
  await expect(page.getByRole('grid', { name: 'Subjects' })).toBeVisible();
  const create = page.getByRole('link', { name: 'Create a subject' });
  for (let pressed = 0; pressed < 40; pressed += 1) {
    if (await create.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(create).toBeFocused();
  await page.keyboard.press('Enter');
  const field = page.getByRole('textbox', { name: 'Username', exact: true });
  await expect(field).toBeFocused();
  await page.keyboard.type(username);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: username })).toBeVisible();
  expect(subjectId(username)).not.toBe('');
  expect(userColumn(username, 'email')).toBe('<null>');
});
