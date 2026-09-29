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

type Column =
  'name' | 'email' | 'phone_number' | 'birthdate' | 'zoneinfo' | 'locale' | 'address_country';

function userColumn(username: string, column: Column): string {
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

test('an operator holding view-users alone sees a subject as text, and nothing to change it with', async ({
  page,
}) => {
  await signIn(page, viewer);
  const rail = page.getByRole('navigation', { name: `Areas of ${TENANT}` });
  await expect(rail.getByRole('link')).toHaveText(['Overview', 'Subjects', 'Switch tenant']);
  await openSubject(page, subjects.edited);
  await expect(page.getByRole('note')).toHaveText(
    'You can view subjects but not change them (needs manage-users).',
  );
  await expect(page.getByText('Full name', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Disable|Delete|Save) /u })).toHaveCount(0);
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Credentials' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Lockout' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Issue|Remove|Revoke|Clear the/u })).toHaveCount(0);
  await expectAccessible(page);

  await page.goto(`/console/${TENANT}/subjects`);
  await expect(page.getByRole('grid', { name: 'Subjects' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a subject' })).toHaveCount(0);
  await expect(page.getByRole('note')).toHaveText(
    'You can view subjects but not change them (needs manage-users).',
  );
  await expectAccessible(page);

  // A shared link to an area the rail leaves out still opens, and explains.
  await page.goto(`/console/${TENANT}/clients`);
  await expect(page.getByText('Clients needs the manage-clients capability.')).toBeVisible();
});

test('a subject’s details are entered through typed fields and stored as the claims say', async ({
  page,
}) => {
  const username = subjects.typed;
  await signIn(page, admin);
  await openSubject(page, username);
  const details = page.getByRole('region', { name: 'Details' });
  const phone = details.getByRole('group', { name: 'Phone number' });
  await phone.getByRole('combobox', { name: 'Country' }).fill('Nigeria');
  await page.getByRole('option', { name: 'Nigeria' }).click();
  await phone.getByRole('textbox', { name: 'Number' }).fill('0803 123 4567');
  await expect(phone).toContainText('Stored as +2348031234567.');
  const birthdate = details.getByRole('group', { name: 'Birthdate' });
  await birthdate.getByText('Year only', { exact: true }).click();
  await birthdate.getByRole('textbox', { name: 'Year' }).fill('1990');
  await details.getByRole('combobox', { name: 'Time zone' }).fill('Lagos');
  await page.getByRole('option', { name: 'Africa/Lagos' }).click();
  await expectAccessible(page);
  await details.getByRole('combobox', { name: 'Locale' }).fill('English (Nig');
  await page.getByRole('option', { name: 'English (Nigeria)' }).click();
  await page.getByRole('button', { name: 'Save Details' }).click();
  await expect(page.getByRole('button', { name: 'Save Details' })).toHaveCount(0);
  expect(userColumn(username, 'phone_number')).toBe('+2348031234567');
  expect(userColumn(username, 'birthdate')).toBe('1990');
  expect(userColumn(username, 'zoneinfo')).toBe('Africa/Lagos');
  expect(userColumn(username, 'locale')).toBe('en-NG');

  const address = page.getByRole('region', { name: 'Address' });
  await address.getByRole('combobox', { name: 'Country' }).fill('Germ');
  await page.getByRole('option', { name: 'Germany' }).click();
  await page.getByRole('button', { name: 'Save Address' }).click();
  await expect(page.getByRole('button', { name: 'Save Address' })).toHaveCount(0);
  expect(userColumn(username, 'address_country')).toBe('Germany');
  await expectAccessible(page);
});

test('a full birthdate is entered by keyboard alone', async ({ page }) => {
  const username = subjects.keyed;
  await signIn(page, admin);
  await openSubject(page, username);
  const birthdate = page.getByRole('group', { name: 'Birthdate' });
  const full = birthdate.getByRole('radio', { name: 'Full date' });
  for (let pressed = 0; pressed < 80; pressed += 1) {
    if (await full.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Space');
  await expect(full).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(birthdate.getByRole('spinbutton').first()).toBeFocused();
  // The browser's locale here is en-US: month, day, year.
  await page.keyboard.type('12101815');
  await expect(birthdate).toContainText('12/10/1815');
  for (let pressed = 0; pressed < 80; pressed += 1) {
    const save = page.getByRole('button', { name: 'Save Details' });
    if (
      (await save.count()) > 0 &&
      (await save.evaluate((node) => node === document.activeElement))
    )
      break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save Details' })).toHaveCount(0);
  expect(userColumn(username, 'birthdate')).toBe('1815-12-10');
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

test('a subject is deleted only once its username is typed, and is gone from the list', async ({
  page,
}) => {
  const username = subjects.doomed;
  await signIn(page, admin);
  await openSubject(page, username);
  await page.getByRole('button', { name: `Delete ${username}` }).click();
  const dialog = page.getByRole('alertdialog', { name: `Delete ${username}?` });
  await expect(dialog.getByRole('button', { name: `Delete ${username}` })).toBeDisabled();
  await expectAccessible(page);
  await dialog.getByRole('textbox', { name: `Type ${username} to confirm` }).fill(username);
  await dialog.getByRole('button', { name: `Delete ${username}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
  expect(subjectId(username)).toBe('');
  await expect(page.getByRole('grid', { name: 'Subjects' })).not.toContainText(username);
});

test('a username is renamed on its record while the tenant allows it', async ({ page }) => {
  const { renamer } = subjects;
  const tenant = renamer.tenant;
  psql(`update tenants set username_editable = true where name = ${sqlText(tenant)}`);
  await signIn(page, renamer);
  const id = psql(
    `select u.subject_id from users u join tenants t on t.id = u.tenant_id where t.name = ${sqlText(tenant)} and u.username = ${sqlText(subjects.renamed)}`,
  );
  await page.goto(`/console/${tenant}/subjects/${id}`);
  const field = page.getByRole('textbox', { name: 'Username', exact: true });
  await expect(field).toHaveValue(subjects.renamed);
  await expectAccessible(page);
  await field.fill(`${subjects.renamed}-2`);
  await page.getByRole('button', { name: 'Save Account' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `${subjects.renamed}-2` }),
  ).toBeVisible();
  expect(psql(`select username from users where subject_id = '${id}'`)).toBe(
    `${subjects.renamed}-2`,
  );
});

test('an administrator who deletes their own subject is signed out, not shown an error', async ({
  page,
}) => {
  const { departing } = subjects;
  await signIn(page, departing);
  await openSubject(page, departing.username);
  await page.getByRole('button', { name: `Delete ${departing.username}` }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete your own account?' });
  await expect(dialog).toContainText('This is your own account');
  await expect(dialog).toContainText('ends your console session at once');
  await expect(dialog).toContainText('cannot be undone');
  await expectAccessible(page);
  await dialog
    .getByRole('textbox', { name: `Type ${departing.username} to confirm` })
    .fill(departing.username);
  await dialog.getByRole('button', { name: `Delete ${departing.username}` }).click();
  await expect(page.getByLabel('Username')).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/^\/tenants\/|^\/console\//u);
  expect(subjectId(departing.username)).toBe('');
  expect((await page.request.get('/console/api/session')).status()).toBe(401);
});
