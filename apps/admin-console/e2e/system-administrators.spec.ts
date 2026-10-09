import type { Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectFitsViewport,
  forgive,
  signIn,
  signInAtTenant,
  test,
} from './fixtures.ts';
import { psql, seeded } from './stack.ts';

const { system, systemAdmins } = seeded();
const AT = '/console/system/system-admins';
const PHONE = { width: 390, height: 844 };

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// The roles of system's built-in admin client a subject holds directly.
function adminRoles(username: string): string {
  return psql(`
    select coalesce(string_agg(r.name, ',' order by r.name), '')
    from users u
    join tenants t on t.id = u.tenant_id and t.name = 'system'
    join subject_roles sr on sr.subject_id = u.subject_id
    join roles r on r.id = sr.role_id
    join clients c on c.id = r.client_id and c.builtin_admin
    where u.username = ${sqlText(username)}`);
}

async function openSystemAdministrators(page: Page): Promise<Locator> {
  await page
    .getByRole('navigation', { name: 'Areas of system' })
    .getByRole('link', { name: 'System administrators' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'System administrators' }),
  ).toBeVisible();
  const list = page.getByRole('list', { name: 'Administrators of system' });
  await expect(list).toBeVisible();
  return list;
}

async function takeSecret(dialog: Locator): Promise<string> {
  const secret = await dialog.locator('code').first().innerText();
  await dialog.getByText(/^I have stored the /u).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  return secret;
}

async function expectNowhere(page: Page, secret: string): Promise<void> {
  expect(await page.content()).not.toContain(secret);
  const stored = await page.evaluate(() =>
    [sessionStorage, localStorage]
      .flatMap((storage) => Object.keys(storage).map((key) => storage.getItem(key) ?? ''))
      .join('\n'),
  );
  expect(stored).not.toContain(secret);
}

async function search(page: Page, username: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search by Username' }).fill(username);
  await page.getByRole('searchbox', { name: 'Search by Username' }).press('Enter');
  await expect(
    page.getByRole('list', { name: 'Administrators of system' }).getByRole('link'),
  ).toHaveText([username]);
}

async function chooseSubject(page: Page, username: string): Promise<void> {
  const choose = page.getByRole('group', { name: 'Subject in system' });
  await choose.getByRole('searchbox', { name: 'Search subjects by username' }).fill(username);
  await choose.getByRole('button', { name: 'Search' }).click();
  await choose.getByRole('option', { name: new RegExp(username, 'u') }).click();
}

// Moves focus with Tab alone until it lands on `target`.
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let pressed = 0; pressed < 40; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test('a system administrator is created with a password shown once, and lands in the list', async ({
  page,
  browser,
}) => {
  const username = systemAdmins.created;
  await signIn(page, system);
  await openSystemAdministrators(page);
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Create a new subject as an administrator' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Add a system administrator' }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`${AT}/new`);
  await expect(
    page.getByRole('navigation', { name: 'Areas of system' }).locator('[aria-current="page"]'),
  ).toHaveText('System administrators');
  await expectAccessible(page);
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  const dialog = page.getByRole('dialog', { name: `${username}'s one-time password` });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  const password = await takeSecret(dialog);
  await expectNowhere(page, password);
  expect(adminRoles(username)).toBe('tenant-admin');

  await page.getByRole('link', { name: 'Back to System administrators' }).click();
  await search(page, username);
  await expect(page.getByRole('list', { name: `What ${username} holds` })).toHaveText(
    'Full (tenant-admin) · directly',
  );
  await expectNowhere(page, password);
  await page.reload();
  await expect(page.getByRole('list', { name: `What ${username} holds` })).toBeVisible();
  await expectNowhere(page, password);

  const theirs = await browser.newContext();
  const theirPage = await theirs.newPage();
  await theirPage.goto('/console/system');
  await signInAtTenant(theirPage, { tenant: 'system', username, password });
  await expect(
    theirPage.getByRole('heading', { level: 1, name: 'Change your password' }),
  ).toBeVisible();
  await theirs.close();
});

test('an existing subject of system is chosen and given Full', async ({ page }) => {
  const { username } = systemAdmins.candidate;
  expect(adminRoles(username)).toBe('');
  await signIn(page, system);
  await openSystemAdministrators(page);
  await chooseSubject(page, username);
  await expect(page.getByRole('checkbox', { name: 'Full (tenant-admin)' })).toBeChecked();
  await expectAccessible(page);
  await page.getByRole('button', { name: `Give it to ${username}` }).click();
  await expect(
    page.getByText(`${username} now holds Full (tenant-admin) in system.`),
  ).toBeVisible();
  expect(adminRoles(username)).toBe('tenant-admin');
  await search(page, username);
  await expectAccessible(page);
});

test('the grant picker marks a current holder and will not choose them', async ({ page }) => {
  const { username } = systemAdmins.limited;
  await signIn(page, system);
  await openSystemAdministrators(page);
  const choose = page.getByRole('group', { name: 'Subject in system' });
  await choose.getByRole('searchbox', { name: 'Search subjects by username' }).fill(username);
  await choose.getByRole('button', { name: 'Search' }).click();
  const holder = choose.getByRole('option', { name: new RegExp(username, 'u') });
  await expect(holder).toHaveAttribute('aria-disabled', 'true');
  await expect(holder).toContainText('already holds a capability');
  await expect(page.getByRole('button', { name: 'Give it to the chosen subject' })).toBeDisabled();
  await expectAccessible(page);
});

test('a grant that meets roles changed under it says so beside the button, and changes nothing', async ({
  page,
  problems,
}) => {
  const { username } = systemAdmins.bystander;
  const before = adminRoles(username);
  await signIn(page, system);
  await openSystemAdministrators(page);
  // Only a race produces a real 412: the ETag is read just before the PUT.
  await page.route(
    (url) => /\/subjects\/[^/]+\/roles$/u.test(url.pathname),
    (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 412,
            contentType: 'application/problem+json',
            json: { type: 'about:blank', title: 'Precondition Failed', status: 412 },
          })
        : route.fallback(),
  );
  await chooseSubject(page, username);
  await page.getByRole('button', { name: `Give it to ${username}` }).click();
  await expect(
    page
      .getByRole('region', { name: 'Add an administrator' })
      .getByRole('status', { name: 'Last grant' }),
  ).toHaveText(`${username} was not given it: their roles changed while this ran. Try again.`);
  expect(adminRoles(username)).toBe(before);
  await expectAccessible(page);
  forgive(problems, '/roles');
});

test('taking system administration is typed, by keyboard alone, and your own says so', async ({
  page,
}) => {
  const { username } = systemAdmins.revokee;
  expect(adminRoles(username)).toBe('tenant-admin');
  await signIn(page, system);
  await openSystemAdministrators(page);

  await search(page, system.username);
  await page.getByRole('button', { name: `Change ${system.username}’s capabilities` }).click();
  const mine = page.getByRole('region', { name: 'Admin capabilities' });
  await mine.getByText('Full (tenant-admin)', { exact: true }).click();
  await mine.getByRole('button', { name: 'Save Admin capabilities' }).click();
  const own = page.getByRole('alertdialog', { name: 'Revoke your own system administration?' });
  await expect(own).toContainText('You are taking Full (tenant-admin) from yourself');
  await expectAccessible(page);
  await own.getByRole('button', { name: 'Cancel' }).click();
  await expect(own).toBeHidden();
  await mine.getByRole('button', { name: /Discard/u }).click();

  const box = page.getByRole('searchbox', { name: 'Search by Username' });
  await box.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(username);
  await page.keyboard.press('Enter');
  const list = page.getByRole('list', { name: 'Administrators of system' });
  await expect(list.getByRole('link')).toHaveText([username]);
  const change = list.getByRole('button', { name: `Change ${username}’s capabilities` });
  await tabTo(page, change);
  await page.keyboard.press('Enter');
  const section = list.getByRole('region', { name: 'Admin capabilities' });
  const full = section.getByRole('checkbox', { name: 'Full (tenant-admin)' });
  await tabTo(page, full);
  await page.keyboard.press('Space');
  const save = section.getByRole('button', { name: 'Save Admin capabilities' });
  await tabTo(page, save);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', {
    name: `Take system administration from ${username}?`,
  });
  await expect(dialog).toContainText(`${username} loses Full (tenant-admin)`);
  await expect(dialog.getByRole('button', { name: 'Save Admin capabilities' })).toBeDisabled();
  await expectAccessible(page);
  await page.keyboard.type(username);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Admin capabilities saved')).toBeVisible();
  expect(adminRoles(username)).toBe('');
  await expectAccessible(page);
});

test('the only enabled holder keeps it, and the editor says why beforehand', async ({ page }) => {
  await signIn(page, system);
  // Every other test shares system, so it keeps its many holders; the count
  // that decides this state is answered for this principal alone.
  const SUBJECTS = '/console/api/admin/tenants/system/subjects';
  await page.route(
    (url) => url.pathname === `${SUBJECTS}/count` && url.searchParams.get('enabled') === 'true',
    (route) => route.fulfill({ json: { count: 1, capped: false } }),
  );
  await openSystemAdministrators(page);
  await search(page, system.username);
  await page.getByRole('button', { name: `Change ${system.username}’s capabilities` }).click();
  const full = page
    .getByRole('region', { name: 'Admin capabilities' })
    .getByRole('checkbox', { name: 'Full (tenant-admin)' });
  await expect(full).toBeDisabled();
  await expect(full).toHaveAccessibleDescription(
    new RegExp(`${system.username} is the only enabled holder of manage-tenants`, 'u'),
  );
  await expectAccessible(page);
});

test('an operator holding manage-tenants and view-users alone is offered none of the changes', async ({
  page,
}) => {
  await signIn(page, systemAdmins.limited);
  await expect(
    page.getByRole('navigation', { name: 'Areas of system' }).getByRole('link'),
  ).toHaveText(['Tenants', 'System administrators', 'Overview', 'Subjects', 'Switch tenant']);
  await openSystemAdministrators(page);
  await expect(page.getByRole('note')).toContainText(
    'You can view system administrators but not create them or change what they hold (needs manage-users',
  );
  await expect(page.getByRole('region', { name: 'Add an administrator' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /capabilities/u })).toHaveCount(0);
  await expectAccessible(page);
});

test('the System administrators page fits a phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, system);
  await page.goto(AT);
  await expect(
    page.getByRole('heading', { level: 1, name: 'System administrators' }),
  ).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expectFitsViewport(page);
  // Empty, yet in the accessibility tree, so what fills it is announced.
  await expect(page.getByRole('status', { name: 'Last grant' })).toBeAttached();
  await expectAccessible(page);
});
