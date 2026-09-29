import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, forgive, signIn, signInAtTenant, test } from './fixtures.ts';
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
  const grid = page.getByRole('grid', { name: 'System administrators' });
  await expect(grid).toBeVisible();
  return grid;
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
}

test('a system administrator is created with a password shown once, and lands in the list', async ({
  page,
  browser,
}) => {
  const username = systemAdmins.created;
  await signIn(page, system);
  const grid = await openSystemAdministrators(page);
  await expect(grid).toContainText(system.username);
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Create a system administrator' }).click();
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
  await expect(page.getByRole('grid', { name: 'System administrators' })).toContainText(username);
  await expectNowhere(page, password);
  await page.reload();
  await expect(page.getByRole('grid', { name: 'System administrators' })).toContainText(username);
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

test('an existing subject of system is chosen and granted tenant-admin', async ({ page }) => {
  const { username } = systemAdmins.candidate;
  expect(adminRoles(username)).toBe('');
  await signIn(page, system);
  await openSystemAdministrators(page);
  const choose = page.getByRole('group', { name: 'Subject in system' });
  await choose.getByRole('searchbox', { name: 'Search subjects by username' }).fill(username);
  await choose.getByRole('button', { name: 'Search' }).click();
  await choose.getByRole('option', { name: new RegExp(username, 'u') }).click();
  await expectAccessible(page);
  await page.getByRole('button', { name: `Grant tenant-admin to ${username}` }).click();
  await expect(page.getByText(`${username} is now a system administrator.`)).toBeVisible();
  expect(adminRoles(username)).toBe('tenant-admin');
  await search(page, username);
  await expect(page.getByRole('grid', { name: 'System administrators' })).toContainText(username);
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
  await expect(holder).toContainText('already a system administrator');
  await expect(page.getByRole('button', { name: 'Grant tenant-admin' })).toBeDisabled();
  await expectAccessible(page);
});

test('a grant that meets roles changed under it says so beside Grant, and changes nothing', async ({
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
  const choose = page.getByRole('group', { name: 'Subject in system' });
  await choose.getByRole('searchbox', { name: 'Search subjects by username' }).fill(username);
  await choose.getByRole('button', { name: 'Search' }).click();
  await choose.getByRole('option', { name: new RegExp(username, 'u') }).click();
  await page.getByRole('button', { name: `Grant tenant-admin to ${username}` }).click();
  await expect(
    page
      .getByRole('region', { name: 'Grant to an existing subject' })
      .getByRole('status', { name: 'Last grant' }),
  ).toHaveText(
    `${username} was not granted tenant-admin: their roles changed while this ran. Try again.`,
  );
  expect(adminRoles(username)).toBe(before);
  await expectAccessible(page);
  forgive(problems, '/roles');
});

test('a revoke is typed, by keyboard alone, and your own says so', async ({ page }) => {
  const { username } = systemAdmins.revokee;
  expect(adminRoles(username)).toBe('tenant-admin');
  await signIn(page, system);
  await openSystemAdministrators(page);

  await page.getByRole('button', { name: `Revoke ${system.username}` }).click();
  const own = page.getByRole('alertdialog', { name: 'Revoke your own system administration?' });
  await expect(own).toContainText('You are revoking your own system administration');
  await expectAccessible(page);
  await own.getByRole('button', { name: 'Cancel' }).click();
  await expect(own).toBeHidden();

  const box = page.getByRole('searchbox', { name: 'Search by Username' });
  await box.focus();
  await page.keyboard.type(username);
  await page.keyboard.press('Enter');
  const grid = page.getByRole('grid', { name: 'System administrators' });
  await expect(grid.getByRole('row')).toHaveCount(2);
  const revoke = page.getByRole('button', { name: `Revoke ${username}` });
  for (let pressed = 0; pressed < 20; pressed += 1) {
    if (await revoke.evaluate((node) => node === document.activeElement)) break;
    const inGrid = await grid.evaluate((node) => node.contains(document.activeElement));
    await page.keyboard.press(inGrid ? 'ArrowRight' : 'Tab');
  }
  await expect(revoke).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: `Revoke ${username}?` });
  await expect(dialog).toContainText(`${username} loses tenant-admin and manage-tenants`);
  await expect(dialog.getByRole('button', { name: 'Revoke' })).toBeDisabled();
  await expectAccessible(page);
  await page.keyboard.type(username);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${username} is no longer a system administrator.`)).toBeVisible();
  // The list was searched down to them, so it now matches nobody.
  await expect(page.getByText(`No system administrators match “${username}”`)).toBeVisible();
  expect(adminRoles(username)).toBe('');
  await expectAccessible(page);
});

test('the only enabled holder cannot be revoked, and the page says why beforehand', async ({
  page,
}) => {
  await signIn(page, system);
  // Every other test shares system, so it keeps its many holders; the two
  // reads that decide this state are narrowed to this principal alone.
  const SUBJECTS = '/console/api/admin/tenants/system/subjects';
  await page.route(
    (url) => url.pathname === `${SUBJECTS}/count` && url.searchParams.get('enabled') === 'true',
    (route) => route.fulfill({ json: { count: 1, capped: false } }),
  );
  await page.route(
    (url) => url.pathname === SUBJECTS && url.searchParams.get('capability') === 'manage-tenants',
    async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set('username', system.username);
      await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
    },
  );
  await openSystemAdministrators(page);
  const revoke = page.getByRole('button', { name: `Revoke ${system.username}` });
  await expect(revoke).toBeDisabled();
  await expect(revoke).toHaveAccessibleDescription(
    `${system.username} is the only enabled system administrator, so revoking them is refused: system would be left with nobody who holds manage-tenants. Add another first.`,
  );
  await expectAccessible(page);
});

test('an operator holding manage-tenants and view-users alone is told what else it needs', async ({
  page,
}) => {
  await signIn(page, systemAdmins.limited);
  await openSystemAdministrators(page);
  await expect(page.getByRole('button', { name: 'Create a system administrator' })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: `Revoke ${systemAdmins.limited.username}` }),
  ).toBeDisabled();
  await expect(
    page.getByText('Creating a system administrator needs the manage-users capability.'),
  ).toBeVisible();
  await expect(
    page.getByText('Granting or revoking tenant-admin needs the manage-clients capability.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Grant tenant-admin/u })).toBeDisabled();
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
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Empty, yet in the accessibility tree, so what fills it is announced.
  await expect(page.getByRole('status', { name: 'Last revoke' })).toBeAttached();
  await expect(page.getByRole('status', { name: 'Last grant' })).toBeAttached();
  await expectAccessible(page);
});
