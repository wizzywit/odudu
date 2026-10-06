import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, expectFitsViewport, forgive, signIn, test } from './fixtures.ts';
import { psql, seeded } from './stack.ts';

const { clients } = seeded();
const { admin, limited } = clients;
const TENANT = admin.tenant;
const UNBROKEN = 'segment'.repeat(8);
const PHONE = { width: 390, height: 844 };

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const IN_TENANT = `(select id from tenants where name = ${sqlText(TENANT)})`;

function clientId(clientKey: string): string {
  return psql(
    `select id from clients where tenant_id = ${IN_TENANT} and client_id = ${sqlText(clientKey)}`,
  );
}

function clientColumn(clientKey: string, column: string): string {
  return psql(
    `select coalesce(${column}::text, '<null>') from clients where tenant_id = ${IN_TENANT} and client_id = ${sqlText(clientKey)}`,
  );
}

// A list column of the client's OpenID Connect configuration, comma-joined.
function configList(clientKey: string, column: string): string {
  return psql(
    `select coalesce(array_to_string(${column}, ','), '') from client_oidc_config where client_id = ${sqlText(clientId(clientKey))}::uuid`,
  );
}

// Moves focus with Tab alone until it lands on `target`.
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let pressed = 0; pressed < 80; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function openClient(page: Page, clientKey: string, tab = 'general'): Promise<void> {
  await page.goto(`/console/${TENANT}/clients/${clientId(clientKey)}?tab=${tab}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

// Writes are offered once the service account's capabilities have been read.
async function waitUntilOffered(page: Page): Promise<void> {
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
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

test('a confidential client is made and its secret is shown once, then nowhere', async ({
  page,
}) => {
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/clients`);
  const table = page.getByRole('grid', { name: 'Clients' });
  await expect(table.getByRole('row', { name: /Ledger/u })).toContainText('Confidential');
  await expect(table.getByRole('row', { name: /kiosk/u })).toContainText('Public');
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Create a client' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create a client' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Client ID' }).fill('made-confidential');
  await page.getByRole('textbox', { name: 'Name' }).fill('Made');
  await page.getByRole('textbox', { name: 'Redirect URI 1' }).fill('https://made.example/callback');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Create client' }).click();

  const dialog = page.getByRole('dialog', { name: 'Client secret for Made' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  const secret = await takeSecret(dialog);
  await expect(page.getByRole('heading', { level: 1, name: 'Made' })).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  const stored = await page.evaluate(() =>
    [sessionStorage, localStorage]
      .flatMap((storage) => Object.keys(storage).map((key) => storage.getItem(key) ?? ''))
      .join('\n'),
  );
  expect(stored).not.toContain(secret);

  await expect.poll(() => clientColumn('made-confidential', 'type')).toBe('confidential');
  expect(clientColumn('made-confidential', 'secret_hash')).not.toContain(secret);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Made' })).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  await expectAccessible(page);
});

test('a public client is made by keyboard alone, with no secret to show', async ({ page }) => {
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/clients/new`);
  await tabTo(page, page.getByRole('textbox', { name: 'Client ID' }));
  await page.keyboard.type('made-public');
  const type = page.getByRole('button', { name: /Confidential/u });
  await tabTo(page, type);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Public/u })).toBeVisible();
  const uri = page.getByRole('textbox', { name: 'Redirect URI 1' });
  await tabTo(page, uri);
  await page.keyboard.type('https://made-public.example/callback');
  const create = page.getByRole('button', { name: 'Create client' });
  await tabTo(page, create);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'made-public' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => clientColumn('made-public', 'type')).toBe('public');
  await expectAccessible(page);
});

test('a client ID already in use is refused beside the ID, and nothing is made', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/clients/new`);
  await page.getByRole('textbox', { name: 'Client ID' }).fill('ledger');
  await page.getByRole('textbox', { name: 'Redirect URI 1' }).fill('https://again.example/cb');
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page.getByText('The client_id "ledger" is already in use.')).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/clients`);
  expect(
    psql(`select count(*) from clients where tenant_id = ${IN_TENANT} and client_id = 'ledger'`),
  ).toBe('1');
});

test('a name changed behind an open page is shown beside yours, and keeping yours saves it', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await openClient(page, 'ledger');
  await waitUntilOffered(page);
  const section = page.getByRole('region', { name: 'Details' });
  await section.getByRole('textbox', { name: 'Name' }).fill('Mine');
  psql(
    `update clients set name = 'Theirs' where tenant_id = ${IN_TENANT} and client_id = 'ledger'`,
  );
  await section.getByRole('button', { name: 'Save Details' }).click();
  await expect(section.getByText(/changed elsewhere/u).first()).toBeVisible();
  await expect(section.getByRole('button', { name: 'Keep mine in Details' })).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/clients/${clientId('ledger')}`);
  // Nothing merged: the other administrator's value is still what is stored.
  await expect.poll(() => clientColumn('ledger', 'name')).toBe('Theirs');

  await section.getByRole('button', { name: 'Keep mine in Details' }).click();
  await expect.poll(() => clientColumn('ledger', 'name')).toBe('Mine');
  await expect(page.getByRole('heading', { level: 1, name: 'Mine' })).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByRole('grid', { name: 'Activity on this client' })).toContainText(
    'client.amend',
  );
  await expectAccessible(page);
});

test("a redirect URI is added and removed, and a non-canonical one is refused in the server's words", async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await openClient(page, 'lists', 'redirects');
  const redirects = page.getByRole('region', { name: 'Redirect URIs' });
  await expect(redirects.getByRole('button', { name: 'Add redirect URI' })).toBeVisible();
  await expect(redirects.getByText(/1 of 200 redirect URIs\./u)).toBeVisible();
  await expectAccessible(page);

  await redirects.getByRole('button', { name: 'Add redirect URI' }).click();
  await redirects
    .getByRole('textbox', { name: 'Redirect URI 2' })
    .fill('https://lists.example/second');
  await redirects.getByRole('button', { name: 'Save Redirect URIs' }).click();
  await expect(redirects.getByText(/2 of 200 redirect URIs\./u)).toBeVisible();
  await expect
    .poll(() => configList('lists', 'redirect_uris'))
    .toBe('https://lists.example/callback,https://lists.example/second');

  await redirects.getByRole('button', { name: /^Remove redirect URI 2,/u }).click();
  await redirects.getByRole('button', { name: 'Save Redirect URIs' }).click();
  await expect
    .poll(() => configList('lists', 'redirect_uris'))
    .toBe('https://lists.example/callback');
  await expectAccessible(page);

  // A trailing slash makes an address a path, not an origin.
  const origins = page.getByRole('region', { name: 'Web origins' });
  await origins.getByRole('button', { name: 'Add web origin' }).click();
  await origins.getByRole('textbox', { name: 'Web origin 2' }).fill('https://lists.example/');
  await origins.getByRole('button', { name: 'Save Web origins' }).click();
  await expect(
    origins.getByText(
      'web_origins entry "https://lists.example/" is not an origin: expected a scheme and host with no path, or "+" for every registered redirect URI\'s origin',
    ),
  ).toBeVisible();
  await expectAccessible(page);
  await expect.poll(() => configList('lists', 'web_origins')).toBe('https://lists.example');

  await redirects.getByRole('button', { name: 'Add redirect URI' }).click();
  await redirects
    .getByRole('textbox', { name: 'Redirect URI 2' })
    .fill('http://lists.example/insecure');
  await redirects.getByRole('button', { name: 'Save Redirect URIs' }).click();
  await expect(
    redirects.getByText('redirect_uris entry http://lists.example/insecure is not valid'),
  ).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/clients/${clientId('lists')}`);
  await expect
    .poll(() => configList('lists', 'redirect_uris'))
    .toBe('https://lists.example/callback');
  await expect(page.getByRole('link', { name: 'Open Logout' })).toHaveAttribute(
    'href',
    `/console/${TENANT}/clients/${clientId('lists')}?tab=logout`,
  );
});

test('a client is deleted once its ID is typed', async ({ page }) => {
  await signIn(page, admin);
  await openClient(page, 'doomed');
  await waitUntilOffered(page);
  await page.getByRole('button', { name: /^Delete doomed/u }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete doomed?' });
  await expect(dialog).toContainText('deletes the client and every role scoped to it');
  await expectAccessible(page);
  await dialog.getByRole('textbox').fill('doomed');
  await dialog.getByRole('button', { name: 'Delete doomed' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  await expect
    .poll(() =>
      psql(`select count(*) from clients where tenant_id = ${IN_TENANT} and client_id = 'doomed'`),
    )
    .toBe('0');
});

test('the built-in admin client is fixed, and said to be', async ({ page }) => {
  await signIn(page, admin);
  await openClient(page, 'odudu-admin');
  await expect(page.getByText(/odudu-admin cannot be disabled\./u)).toBeVisible();
  await expect(page.getByText(/odudu-admin cannot be deleted\./u)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete/u })).toHaveCount(0);
  await expectAccessible(page);
});

test('an operator holding manage-clients alone is offered no write on a client with a service account', async ({
  page,
  problems,
}) => {
  await signIn(page, limited);
  await openClient(page, 'closed');
  await expect(
    page.getByText(/reading that needs view-users, which you do not hold/u),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Delete/u })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save/u })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('closed');
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Redirects & origins' }).click();
  await expect(page.getByRole('button', { name: 'Add redirect URI' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Redirect URIs' })).toContainText(
    'https://closed.example/callback',
  );
  await expectAccessible(page);
  // What its service account holds is the one read this operator is refused.
  forgive(problems, '/admin-capabilities');
  expect(clientColumn('closed', 'name')).toBe('closed');

  // A public client has no service account to judge, so its writes are offered at once.
  await openClient(page, 'kiosk');
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
  await expectAccessible(page);
});

test('the clients pages fit a phone', async ({ page }) => {
  test.slow();
  await page.setViewportSize(PHONE);
  await signIn(page, admin);
  const pages = [
    `/console/${TENANT}/clients`,
    `/console/${TENANT}/clients/new`,
    `/console/${TENANT}/clients/${clientId('ledger')}`,
    `/console/${TENANT}/clients/${clientId('ledger')}?tab=redirects`,
    `/console/${TENANT}/clients/${clientId(UNBROKEN)}`,
    `/console/${TENANT}/clients/${clientId(UNBROKEN)}?tab=redirects`,
  ];
  for (const address of pages) {
    await page.goto(address);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.locator('[role="status"]', { hasText: /^Loading/u })).toHaveCount(0);
    await expect(page.getByText(/^Checking /u)).toHaveCount(0);
    await expectFitsViewport(page, address);
    await expectAccessible(page);
  }
});
