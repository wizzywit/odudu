import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { z } from 'zod';
import {
  expect,
  expectAccessible,
  expectFitsViewport,
  forgive,
  signIn,
  signInAtTenant,
  test,
} from './fixtures.ts';
import { psql, seeded, type Account } from './stack.ts';

const { admin, limited, resumer, system, systemAdmins, tenants } = seeded();
const PHONE = { width: 390, height: 844 };

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function tenantColumn(name: string, column: 'display_name' | 'enabled'): string {
  return psql(
    `select coalesce(${column}::text, '<null>') from tenants where name = ${sqlText(name)}`,
  );
}

async function signInToSystem(page: Page, account: Account = system): Promise<void> {
  await signIn(page, account);
}

// Reads the secret a SecretDialog shows once, acknowledges it and closes it.
async function takeSecret(dialog: Locator): Promise<string> {
  const secret = await dialog.locator('code').first().innerText();
  await dialog.getByText(/^I have stored the /u).click();
  await expect(dialog.getByRole('checkbox')).toBeChecked();
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

test('a system administrator creates a tenant whose first administrator signs in with the password shown once', async ({
  page,
  browser,
}) => {
  const name = `${tenants.prefix}1`;
  await signInToSystem(page);
  await page
    .getByRole('navigation', { name: 'Areas of system' })
    .getByRole('link', { name: 'Tenants' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Tenants' })).toContainText(tenants.general);
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Create a tenant' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create a tenant' })).toBeVisible();
  const field = page.getByRole('textbox', { name: 'Name', exact: true });
  await field.fill('Not A Label');
  await page.getByRole('button', { name: 'Create tenant' }).click();
  await expect(field).toHaveAccessibleDescription(/lowercase letters, digits or hyphens/u);
  await field.fill(name);
  const origin = new URL(page.url()).origin;
  await expect(page.getByText(`${origin}/tenants/${name}`, { exact: true })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Create tenant' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: `First administrator of ${name}` }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('textbox', { name: 'Username' }).fill('first');
  await page.getByRole('button', { name: 'Create administrator' }).click();
  const dialog = page.getByRole('dialog', { name: "first's one-time password" });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  const password = await takeSecret(dialog);

  await expect(page.getByRole('link', { name: `Open ${name}` })).toBeVisible();
  await expectAccessible(page);
  await expectNowhere(page, password);
  await page.reload();
  await expect(page.getByRole('link', { name: `Open ${name}` })).toBeVisible();
  await expectNowhere(page, password);

  // The grant landed: the tenant lists them among its administrators.
  await page.getByRole('link', { name: `Open ${name}` }).click();
  await page.getByRole('tab', { name: 'Administrators' }).click();
  await expect(page.getByRole('list', { name: `Administrators of ${name}` })).toContainText(
    'first',
  );
  await expect(page.getByText('1 administrator')).toBeVisible();
  await expectAccessible(page);

  const theirs = await browser.newContext();
  const theirPage = await theirs.newPage();
  await theirPage.goto(`/console/${name}`);
  await signInAtTenant(theirPage, { tenant: name, username: 'first', password });
  await expect(
    theirPage.getByRole('heading', { level: 1, name: 'Change your password' }),
  ).toBeVisible();
  await theirs.close();
});

test('a creation carries on after a reload, from what was typed and what landed', async ({
  page,
}) => {
  const name = `${tenants.prefix}2`;
  await signInToSystem(page);
  await page.goto('/console/system/new-tenant');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Display name' }).fill('Resumed');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name);
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Resumed');
  await page.getByRole('button', { name: 'Create tenant' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `First administrator of ${name}` }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: `First administrator of ${name}` }),
  ).toBeVisible();
  expect(tenantColumn(name, 'display_name')).toBe('Resumed');
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
});

test('an administrator begun on a tenant leaves Create a tenant at its tenant step', async ({
  page,
}) => {
  await signInToSystem(page);
  await page.goto(`/console/system/tenants/${tenants.general}?tab=administrators`);
  await page.getByRole('button', { name: 'Add an administrator' }).click();
  await expect(page).toHaveURL(`/console/system/tenants/${tenants.general}/new-administrator`);
  await expect(
    page.getByRole('heading', { level: 1, name: `Add an administrator to ${tenants.general}` }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Steps' })).toHaveCount(0);
  const username = page.getByRole('textbox', { name: 'Username' });
  await username.fill('begun');
  await expectAccessible(page);

  await page
    .getByRole('navigation', { name: 'Areas of system' })
    .getByRole('link', { name: 'Tenants' })
    .click();
  await page.getByRole('link', { name: 'Create a tenant' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create a tenant' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
  await expect(page).toHaveURL('/console/system/new-tenant');
  await expectAccessible(page);

  await page.goto(`/console/system/tenants/${tenants.general}/new-administrator`);
  await expect(username).toHaveValue('begun');
});

test('a display name saves on its ETag and focus lands on the section, and a disable is typed', async ({
  page,
}) => {
  const name = tenants.general;
  await signInToSystem(page);
  await page.goto(`/console/system/tenants/${name}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('textbox', { name: 'Display name' }).fill('General Tenant');
  await page.getByRole('button', { name: 'Save General' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'General' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Save General' })).toBeHidden();
  expect(tenantColumn(name, 'display_name')).toBe('General Tenant');

  // By keyboard alone, from the heading focus was left on.
  const disable = page.getByRole('button', { name: `Disable ${name}` });
  for (let pressed = 0; pressed < 12; pressed += 1) {
    if (await disable.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(disable).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: `Disable ${name}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: `Disable ${name}` })).toBeDisabled();
  await expectAccessible(page);
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  const enable = page.getByRole('button', { name: `Enable ${name}` });
  await expect(enable).toBeFocused();
  expect(tenantColumn(name, 'enabled')).toBe('false');
  await expectAccessible(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: `Disable ${name}` })).toBeVisible();
  expect(tenantColumn(name, 'enabled')).toBe('true');
});

test('a save refused with 412 shows theirs beside yours, and keeping mine lands focus on the section', async ({
  page,
  problems,
}) => {
  const name = tenants.conflict;
  await signInToSystem(page);
  await page.goto(`/console/system/tenants/${name}`);
  await page.getByRole('textbox', { name: 'Display name' }).fill('Mine');
  psql(`update tenants set display_name = 'Theirs' where name = ${sqlText(name)}`);
  await page.getByRole('button', { name: 'Save General' }).click();
  const table = page.getByRole('table', { name: 'Changed in General since you opened it' });
  await expect(table.getByRole('row', { name: /Display name/u })).toContainText('TheirsMine');
  await expectAccessible(page);
  forgive(problems, `/console/api/admin/tenants/${name}`);
  await page.getByRole('button', { name: 'Keep mine in General' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'General' })).toBeFocused();
  await expect(table).toBeHidden();
  // The panel and the focus move as the save is sent, not when it lands.
  await expect.poll(() => tenantColumn(name, 'display_name')).toBe('Mine');
});

test('an export downloads as the bytes served, and imports again as a new tenant', async ({
  page,
  problems,
}) => {
  const name = `${tenants.prefix}3`;
  await signInToSystem(page);
  await page.goto(`/console/system/tenants/${tenants.source}?tab=export`);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to a file' }).click();
  const download = await downloading;
  const today = new Date().toISOString().slice(0, 10);
  expect(download.suggestedFilename()).toBe(`${tenants.source}-${today}.odudu-tenant.json`);
  const text = await readFile(await download.path(), 'utf8');
  const served = await page.request.get(`/console/api/admin/tenants/${tenants.source}/export`);
  expect(text).toBe(await served.text());
  const exported = z
    .looseObject({
      version: z.literal(1),
      clients: z.array(
        z.looseObject({ client_id: z.string(), redirect_uris: z.array(z.string()) }),
      ),
      omitted: z.array(z.string()),
    })
    .parse(JSON.parse(text));
  await expect(page.getByRole('list', { name: 'Left out of the file' })).toContainText(
    exported.omitted[0] ?? 'nothing',
  );
  await expectAccessible(page);

  await page.goto('/console/system/import-tenant');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  const broken = {
    ...exported,
    clients: exported.clients.map((client) => ({ ...client, redirect_uris: ['not a uri'] })),
  };
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: 'broken.odudu-tenant.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });
  await page.getByRole('button', { name: 'Import' }).click();
  const refusals = page.getByRole('region', { name: /problems? in the document/u });
  await expect(refusals).toContainText('redirect_uris');
  forgive(problems, '/console/api/admin/tenant-imports');
  await expectAccessible(page);
  expect(psql(`select count(*) from tenants where name = ${sqlText(name)}`)).toBe('0');

  await input.setInputFiles(await download.path());
  await page.getByRole('button', { name: 'Import' }).click();
  const secrets: string[] = [];
  const dialog = page.getByRole('dialog', { name: /^Client secret for / });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  while (await dialog.isVisible()) secrets.push(await takeSecret(dialog));
  expect(secrets.length).toBeGreaterThan(0);
  for (const secret of secrets) await expectNowhere(page, secret);

  await page.getByRole('button', { name: 'Create the first administrator' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `First administrator of ${name}` }),
  ).toBeVisible();
  await expect(page.getByText(/An import creates no administrator/u)).toBeVisible();
});

test('an operator without the capabilities an export needs is told which, and sees no System area', async ({
  page,
}) => {
  await signIn(page, limited);
  await page.goto(`/console/${limited.tenant}/export`);
  await expect(page.getByRole('heading', { level: 1, name: 'Export' })).toBeVisible();
  await expect(page.getByText(/An export needs the/u)).toContainText('manage-clients');
  await expect(page.getByRole('button', { name: 'Export to a file' })).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: `Areas of ${limited.tenant}` }).getByRole('link'),
  ).not.toContainText(['Clients']);
  await expectAccessible(page);
  await page.goto(`/console/${limited.tenant}/tenants`);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

test('a system administrator holding manage-tenants alone is told what a tenant record needs', async ({
  page,
}) => {
  await signIn(page, systemAdmins.limited);
  const rail = page.getByRole('navigation', { name: 'Areas of system' });
  await expect(rail.getByRole('link')).toHaveText([
    'Tenants',
    'System administrators',
    'Overview',
    'Subjects',
    'Switch tenant',
  ]);
  await rail.getByRole('link', { name: 'Tenants' }).click();
  const list = page.getByRole('grid', { name: 'Tenants' });
  await expect(list).toBeVisible();
  await expect(page.getByRole('note')).toHaveText(
    'You can view tenants but not open their records (needs manage-tenant).',
  );
  await list.getByRole('row', { name: new RegExp(tenants.general, 'u') }).click();
  await expect(page).toHaveURL('/console/system/tenants');
  await expect(list.getByRole('link', { name: `Enter ${tenants.general}` })).toBeVisible();
  await expectAccessible(page);

  // A shared link to the record still opens, and explains.
  await page.goto(`/console/system/tenants/${tenants.general}`);
  await expect(page.getByRole('heading', { level: 1, name: tenants.general })).toBeVisible();
  await expect(page.getByRole('note')).toHaveText(
    "A tenant's record needs the manage-tenant capability.",
  );
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Disable|Enable|Add) /u })).toHaveCount(0);
  await expect(page.getByRole('link', { name: `Enter ${tenants.general}` })).toBeVisible();
  await expectAccessible(page);
});

test('a tenant administrator exports their own tenant from its Export area', async ({ page }) => {
  await signIn(page, admin);
  await page
    .getByRole('navigation', { name: `Areas of ${admin.tenant}` })
    .getByRole('link', { name: 'Export' })
    .click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to a file' }).click();
  expect((await downloading).suggestedFilename()).toMatch(
    new RegExp(`^${admin.tenant}-\\d{4}-\\d{2}-\\d{2}\\.odudu-tenant\\.json$`, 'u'),
  );
  await expect(page.getByRole('link', { name: /Import/u })).toHaveCount(0);
});

test('the tenant pages fit a phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signInToSystem(page);
  for (const path of [
    '/console/system/tenants',
    '/console/system/new-tenant',
    '/console/system/import-tenant',
    `/console/system/tenants/${tenants.general}`,
    `/console/system/tenants/${tenants.general}/new-administrator`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expectFitsViewport(page, path);
    await expectAccessible(page);
  }
});

test('a session that ends mid-edit restores the draft after sign-in and saves nothing', async ({
  page,
  problems,
}) => {
  const name = tenants.resume;
  await signInToSystem(page, resumer);
  await page.goto(`/console/system/tenants/${name}`);
  await page.getByRole('textbox', { name: 'Display name' }).fill('Kept across sign-in');
  psql(
    `delete from console_sessions where subject_id in (select u.subject_id from users u ` +
      `join tenants t on t.id = u.tenant_id where t.name = 'system' ` +
      `and u.username = ${sqlText(resumer.username)})`,
  );
  const back = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/console/api/session' && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Save General' }).click();
  await back;
  forgive(problems, `/console/api/admin/tenants/${name}`);

  await expect(page).toHaveURL(`/console/system/tenants/${name}`);
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue(
    'Kept across sign-in',
  );
  await expect(page.getByText('Restored — review before saving')).toBeVisible();
  expect(tenantColumn(name, 'display_name')).toBe('<null>');

  // A dirty section asks before the page goes, however it goes.
  const asked = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const dialog = await asked;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.accept();
});
