import { createHash, randomBytes } from 'node:crypto';
import type { Browser, Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectFitsViewport,
  forgive,
  signIn,
  signInAtTenant,
  test,
} from './fixtures.ts';
import { psql, seeded, sendLogouts, type Account } from './stack.ts';

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

// A column of the client's OpenID Connect configuration, as text.
function configColumn(clientKey: string, column: string): string {
  return psql(
    `select coalesce(${column}::text, '<null>') from client_oidc_config where client_id = ${sqlText(clientId(clientKey))}::uuid`,
  );
}

function keysStored(clientKey: string): string {
  return psql(
    `select (jwks is not null)::text from client_oidc_config where client_id = ${sqlText(clientId(clientKey))}::uuid`,
  );
}

function scopeAssignments(clientKey: string, scope: string): string {
  return psql(
    `select count(*) from client_scope_assignments where client_id = ${sqlText(clientId(clientKey))}::uuid and client_scope_id = (select id from client_scopes where tenant_id = ${IN_TENANT} and name = ${sqlText(scope)})`,
  );
}

function serviceRoles(clientKey: string): string {
  return psql(
    `select coalesce(string_agg(r.name, ','  order by r.name), '') from subject_roles sr join roles r on r.id = sr.role_id where sr.subject_id = (select service_subject_id from clients where id = ${sqlText(clientId(clientKey))}::uuid) and r.client_id is null`,
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
  const kind = page.getByRole('button', { name: /Web application/u });
  await tabTo(page, kind);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Public application/u })).toBeVisible();
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

test('a service is made with no redirect URI, and its secret is shown once', async ({ page }) => {
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/clients/new`);
  await page.getByRole('button', { name: /Web application/u }).click();
  await page.getByRole('option', { name: 'Service' }).click();
  await expect(page.getByRole('group', { name: 'Redirect URIs' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Client ID' }).fill('made-service');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Create client' }).click();
  const dialog = page.getByRole('dialog', { name: /^Client secret for / });
  await expect(dialog).toBeVisible();
  const secret = await takeSecret(dialog);
  await expect(page.getByRole('heading', { level: 1, name: 'made-service' })).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  await expect.poll(() => configList('made-service', 'grant_types')).toBe('client_credentials');
  expect(configList('made-service', 'redirect_uris')).toBe('');
  expect(clientColumn('made-service', 'type')).toBe('confidential');
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

test('an operator holding manage-clients alone edits a confidential client, with no read of its account', async ({
  page,
}) => {
  const read: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/admin-capabilities')) read.push(request.url());
  });
  await signIn(page, limited);
  await openClient(page, 'closed');
  await waitUntilOffered(page);
  const section = page.getByRole('region', { name: 'Details' });
  await section.getByRole('textbox', { name: 'Name' }).fill('Closed books');
  await section.getByRole('button', { name: 'Save Details' }).click();
  await expect.poll(() => clientColumn('closed', 'name')).toBe('Closed books');
  await expectAccessible(page);
  expect(read).toEqual([]);

  await openClient(page, 'kiosk');
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
  await expectAccessible(page);
});

test('an operator is offered no write on a client whose service account holds what it does not', async ({
  page,
}) => {
  await signIn(page, limited);
  await openClient(page, 'held');
  await expect(
    page.getByText(
      "held's service account holds view-users and manage-users, which you do not, so you cannot change held.",
    ),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Delete/u })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save/u })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('held');
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Redirects & origins' }).click();
  await expect(page.getByRole('button', { name: 'Add redirect URI' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Redirect URIs' })).toContainText(
    'https://held.example/callback',
  );
  await expectAccessible(page);
  expect(clientColumn('held', 'name')).toBe('held');
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

test('a token lifetime and a grant type are changed, each on its own save and read back as stored', async ({
  page,
}) => {
  await signIn(page, admin);
  await openClient(page, 'tokens', 'tokens');
  const lifetimes = page.getByRole('region', { name: 'Token lifetimes' });
  await expect(
    lifetimes.getByRole('switch', { name: "Use the tenant's access token lifetime" }),
  ).toBeVisible();
  expect(configColumn('tokens', 'access_token_ttl_seconds')).toBe('<null>');
  await expectAccessible(page);

  await lifetimes.getByText("Use the tenant's access token lifetime", { exact: true }).click();
  const access = lifetimes.getByRole('textbox', { name: 'Access token lifetime, in seconds' });
  await access.fill('900');
  await access.press('Tab');
  await expect(lifetimes.getByText('900 s · 15 minutes')).toBeVisible();
  await expectAccessible(page);
  await lifetimes.getByRole('button', { name: 'Save Token lifetimes' }).click();
  await expect.poll(() => configColumn('tokens', 'access_token_ttl_seconds')).toBe('900');
  expect(configColumn('tokens', 'id_token_ttl_seconds')).toBe('<null>');

  const grants = page.getByRole('region', { name: 'Grant types' });
  expect(configList('tokens', 'grant_types')).toBe(
    'authorization_code,refresh_token,client_credentials',
  );
  await grants.getByText('Token exchange', { exact: true }).click();
  await expect(grants.getByRole('checkbox', { name: 'Token exchange' })).toBeChecked();
  await grants.getByRole('button', { name: 'Save Grant types' }).click();
  await expect
    .poll(() => configList('tokens', 'grant_types'))
    .toBe(
      'authorization_code,refresh_token,client_credentials,urn:ietf:params:oauth:grant-type:token-exchange',
    );
  await expectAccessible(page);

  // A lifetime past the range the server holds is held to it, and nothing is stored.
  await lifetimes.getByRole('textbox', { name: 'Access token lifetime, in seconds' }).fill('7200');
  await lifetimes.getByRole('textbox', { name: 'Access token lifetime, in seconds' }).press('Tab');
  await expect(
    lifetimes.getByRole('textbox', { name: 'Access token lifetime, in seconds' }),
  ).toHaveValue('3600');
  expect(configColumn('tokens', 'access_token_ttl_seconds')).toBe('900');
});

test('a scope is assigned and unassigned, and the next save is on the fresh ETag', async ({
  page,
}) => {
  await signIn(page, admin);
  await openClient(page, 'scoped', 'scopes');
  const assigned = page.getByRole('region', { name: 'Assigned scopes' });
  await expect(assigned.getByText('openid', { exact: true })).toBeVisible();
  expect(scopeAssignments('scoped', 'reports:read')).toBe('0');
  await expectAccessible(page);

  const assign = page.getByRole('region', { name: 'Assign a scope' });
  await assign.getByRole('searchbox', { name: 'Search scopes by name' }).fill('reports');
  await assign.getByRole('button', { name: 'Search' }).click();
  await assign.getByRole('option', { name: /reports:read/u }).click();
  await assign.getByRole('button', { name: 'Assign scope reports:read' }).click();
  await expect.poll(() => scopeAssignments('scoped', 'reports:read')).toBe('1');
  await expect(assigned.getByText('reports:read', { exact: true })).toBeVisible();
  await expectAccessible(page);

  // The record was read again, so a section saves with no conflict.
  await page.getByRole('tab', { name: 'Tokens' }).click();
  const lifetimes = page.getByRole('region', { name: 'Token lifetimes' });
  await lifetimes.getByText("Use the tenant's refresh token lifetime", { exact: true }).click();
  await lifetimes.getByRole('button', { name: 'Save Token lifetimes' }).click();
  await expect.poll(() => configColumn('scoped', 'refresh_token_ttl_seconds')).toBe('86400');
  await expect(page.getByText(/changed elsewhere/u)).toHaveCount(0);

  await page.getByRole('tab', { name: 'Scopes' }).click();
  await assigned.getByRole('button', { name: 'Remove reports:read' }).click();
  await expect.poll(() => scopeAssignments('scoped', 'reports:read')).toBe('0');
  await expect(assigned.getByText('reports:read', { exact: true })).toHaveCount(0);
  await expect(assigned.getByRole('heading', { name: 'Assigned scopes' })).toBeFocused();
  await expectAccessible(page);
});

test('a key set carrying a private member is refused in the server words, and a public one is kept', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await openClient(page, 'keyed', 'advanced');
  const section = page.getByRole('region', { name: 'Client keys' });
  await expect(section.getByRole('button', { name: /Key source/u })).toBeVisible();
  await section.getByRole('button', { name: /Key source/u }).click();
  await page.getByRole('option', { name: 'A key set pasted here' }).click();
  const publicKey = {
    kty: 'EC',
    crv: 'P-256',
    x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
    y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
    kid: 'k1',
    use: 'sig',
  };
  const box = section.getByRole('textbox', { name: 'Key set' });
  await box.fill(
    JSON.stringify({ keys: [{ ...publicKey, d: 'jpQNz0WqYeXx8MOD8fclvPHylIlzHp1dhCS7sKjvm3M' }] }),
  );
  await section.getByRole('button', { name: 'Save Client keys' }).click();
  await expect(
    section.getByText('jwks.keys[0] carries the private member d; register public keys only'),
  ).toBeVisible();
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page);
  forgive(problems, `/clients/${clientId('keyed')}`);
  expect(configColumn('keyed', 'jwks')).toBe('<null>');

  await box.fill(JSON.stringify({ keys: [publicKey] }));
  await section.getByRole('button', { name: 'Save Client keys' }).click();
  await expect.poll(() => keysStored('keyed')).toBe('true');
  await expectAccessible(page);
});

test('a secret is rotated behind a confirmation, shown once, and the replaced one is kept for its grace', async ({
  page,
}) => {
  await signIn(page, admin);
  await openClient(page, 'rotated', 'advanced');
  const section = page.getByRole('region', { name: 'Client secret' });
  const before = clientColumn('rotated', 'secret_hash');
  const grace = section.getByRole('textbox', { name: 'Grace period' });
  await grace.fill('3600');
  await grace.press('Tab');
  await expect(section.getByText('3600 s · 1 hour')).toBeVisible();
  await section.getByRole('button', { name: /^Rotate the secret of/u }).click();
  const confirm = page.getByRole('alertdialog', { name: /^Rotate the secret of/u });
  await expect(confirm).toContainText('keeps working for 3600 s · 1 hour, then stops');
  await expectAccessible(page);
  expect(clientColumn('rotated', 'secret_hash')).toBe(before);
  await confirm.getByRole('button', { name: 'Rotate secret' }).click();

  const dialog = page.getByRole('dialog', { name: /^New client secret for / });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  const secret = await takeSecret(dialog);
  await expect.poll(() => clientColumn('rotated', 'secret_hash')).not.toBe(before);
  expect(clientColumn('rotated', 'secret_hash')).not.toContain(secret);
  expect(clientColumn('rotated', 'previous_secret_hash')).not.toBe('<null>');
  await expect(page.getByText(/The previous secret authenticates until/u)).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  const stored = await page.evaluate(() =>
    [sessionStorage, localStorage]
      .flatMap((storage) => Object.keys(storage).map((key) => storage.getItem(key) ?? ''))
      .join('\n'),
  );
  expect(stored).not.toContain(secret);
  await page.reload();
  await expect(section.getByRole('textbox', { name: 'Grace period' })).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  await expectAccessible(page);
});

test("a service account's roles are set, and a caller without manage-users is told what it needs", async ({
  browser,
  page,
}) => {
  await signIn(page, admin);
  await openClient(page, 'serviced', 'service');
  const section = page.getByRole('region', { name: 'Roles' });
  await expect(section.getByRole('option', { name: /reader/u })).toBeVisible();
  expect(serviceRoles('serviced')).toBe('');
  await expectAccessible(page);
  await section.getByRole('option', { name: 'reader, a tenant role' }).click();
  await section.getByRole('button', { name: 'Save Roles' }).click();
  await expect.poll(() => serviceRoles('serviced')).toBe('reader');
  await expect(page.getByRole('list', { name: /service account/u })).toContainText('reader');
  await expectAccessible(page);

  const context = await browser.newContext();
  const other = await context.newPage();
  const asked: string[] = [];
  other.on('request', (request) => {
    if (request.url().includes('/subjects/')) asked.push(request.url());
  });
  await signIn(other, limited);
  await openClient(other, 'serviced', 'service');
  await expect(
    other.getByText("The service account's roles needs the manage-users capability."),
  ).toBeVisible();
  await expect(other.getByRole('button', { name: /^Save/u })).toHaveCount(0);
  await expectAccessible(other);
  expect(asked).toEqual([]);
  expect(serviceRoles('serviced')).toBe('reader');
  await context.close();
});

test('a role is made for the client, and an operator without manage-tenant is told what it needs', async ({
  browser,
  page,
}) => {
  await signIn(page, admin);
  await openClient(page, 'ledger', 'roles');
  await expect(page.getByRole('grid', { name: /^Roles of / })).toContainText('approver');
  await expectAccessible(page);
  const section = page.getByRole('region', { name: 'New role' });
  await section.getByRole('textbox', { name: 'Role name' }).fill('bookkeeper');
  await section.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByRole('grid', { name: /^Roles of / })).toContainText('bookkeeper');
  expect(
    psql(
      `select count(*) from roles where tenant_id = ${IN_TENANT} and name = 'bookkeeper' and client_id = ${sqlText(clientId('ledger'))}::uuid`,
    ),
  ).toBe('1');
  await expectAccessible(page);

  const context = await browser.newContext();
  const other = await context.newPage();
  await signIn(other, limited);
  await openClient(other, 'ledger', 'roles');
  await expect(other.getByText('Roles needs the manage-tenant capability.')).toBeVisible();
  await expectAccessible(other);
  await context.close();
});

test("a client's installation is shown, and its claims are worked out for a subject", async ({
  page,
}) => {
  await signIn(page, admin);
  await openClient(page, 'ledger', 'advanced');
  const installation = page.getByRole('region', { name: 'Installation' });
  await expect(installation.getByRole('button', { name: 'Copy client id' })).toBeVisible();
  await expect(installation).toContainText('https://ledger.example/callback');
  await expect(installation).toContainText(`/${TENANT}`);
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Scopes' }).click();
  const evaluate = page.getByRole('region', { name: 'Evaluate' });
  await evaluate
    .getByRole('searchbox', { name: 'Search subjects by username' })
    .fill(admin.username);
  await evaluate.getByRole('button', { name: 'Search' }).click();
  await evaluate.getByRole('option', { name: new RegExp(admin.username, 'u') }).click();
  await evaluate.getByRole('button', { name: 'Evaluate claims' }).click();
  await expect(evaluate.getByText(/^Claims for openid/u)).toBeVisible();
  await expect(evaluate.getByRole('region', { name: 'ID token claims' })).toContainText('"sub"');
  await expect(evaluate.getByRole('region', { name: 'UserInfo claims' })).toContainText('"sub"');
  await expectAccessible(page);
});

const CALLBACK = 'http://127.0.0.1:9/callback';

// A person signing in through a public client, as its application would send
// them: a code, redeemed for the grant and the session the client's tabs list.
async function signInThrough(browser: Browser, account: Account, clientKey: string): Promise<void> {
  const verifier = randomBytes(32).toString('base64url');
  const context = await browser.newContext();
  try {
    await context.route(`${CALLBACK}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Callback</h1>' }),
    );
    const page = await context.newPage();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientKey,
      redirect_uri: CALLBACK,
      scope: 'openid',
      state: 'kept',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    await page.goto(`/tenants/${account.tenant}/protocol/openid-connect/auth?${query.toString()}`);
    await signInAtTenant(page, account);
    await page.waitForURL((url) => url.href.startsWith(CALLBACK));
    const code = new URL(page.url()).searchParams.get('code') ?? '';
    const redeemed = await page.request.post(
      `/tenants/${account.tenant}/protocol/openid-connect/token`,
      {
        form: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: CALLBACK,
          client_id: clientKey,
          code_verifier: verifier,
        },
      },
    );
    expect(redeemed.status()).toBe(200);
  } finally {
    await context.close();
  }
}

function liveGrants(clientKey: string): string {
  return psql(
    `select count(*) from token_grants where client_id = ${sqlText(clientId(clientKey))}::uuid and revoked_at is null`,
  );
}

test('who is signed in through a client is listed, and revoking its tokens leaves what the caller may not touch', async ({
  browser,
  page,
}) => {
  const [first, second] = clients.walkers;
  if (first === undefined || second === undefined) throw new Error('no walkers were seeded');
  await signInThrough(browser, first, 'granted');
  await signInThrough(browser, admin, 'granted');
  expect(liveGrants('granted')).toBe('2');

  const context = await browser.newContext();
  const operator = await context.newPage();
  await signIn(operator, clients.sessions);
  await openClient(operator, 'granted', 'sessions');
  const sessions = operator.getByRole('grid', { name: /^Sessions through / });
  await expect(sessions).toContainText(first.username);
  await expect(sessions).toContainText(admin.username);
  await expectAccessible(operator);
  await operator.getByRole('button', { name: 'Revoke every token of granted' }).click();
  const asked = operator.getByRole('alertdialog', { name: 'Revoke every token of granted?' });
  await expect(asked.getByRole('button', { name: 'Revoke every token' })).toBeDisabled();
  await asked.getByRole('textbox').fill('granted');
  await asked.getByRole('button', { name: 'Revoke every token' }).click();
  await expect(
    operator.getByText(
      '1 grant of granted revoked. 1 left alone, their subjects holding an admin capability you do not.',
    ),
  ).toBeVisible();
  await expect.poll(() => liveGrants('granted')).toBe('1');
  await expectAccessible(operator);
  await context.close();

  await signIn(page, admin);
  await openClient(page, 'granted', 'sessions');
  await page.getByRole('button', { name: 'Revoke every token of granted' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Revoke every token of granted?' });
  await dialog.getByRole('textbox').fill('granted');
  await dialog.getByRole('button', { name: 'Revoke every token' }).click();
  await expect(page.getByText('1 grant of granted revoked.', { exact: true })).toBeVisible();
  await expect.poll(() => liveGrants('granted')).toBe('0');
  await expect
    .poll(() =>
      psql(
        `select count(*) from audit_events where tenant_id = ${IN_TENANT} and action = 'client.grants_revoke' and resource_id = ${sqlText(clientId('granted'))}`,
      ),
    )
    .toBe('2');
  await expectAccessible(page);
});

test("the console's own client says revoking its tokens signs the caller out", async ({ page }) => {
  await signIn(page, admin);
  await openClient(page, 'odudu-admin', 'sessions');
  const sessions = page.getByRole('grid', { name: /^Sessions through / });
  await expect(sessions).toContainText(admin.username);
  await page.getByRole('button', { name: /^Revoke every token of/u }).click();
  const dialog = page.getByRole('alertdialog', { name: /^Revoke every token of/u });
  await expect(dialog).toContainText('you will be signed out');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('the back-channel deliveries of a client are those its ended sessions queued, failed for an address nobody may reach', async ({
  browser,
  page,
}) => {
  await signIn(page, admin);
  await openClient(page, 'notified', 'logout');
  const channel = page.getByRole('region', { name: 'Back-channel logout' });
  await channel
    .getByRole('textbox', { name: 'Back-channel logout address' })
    .fill('https://127.0.0.1:9/backchannel');
  await channel.getByRole('button', { name: 'Save Back-channel logout' }).click();
  await expect
    .poll(() => configColumn('notified', 'backchannel_logout_uri'))
    .toBe('https://127.0.0.1:9/backchannel');

  const [first, second] = clients.walkers;
  if (first === undefined || second === undefined) throw new Error('no walkers were seeded');
  for (const walker of [first, second]) {
    await signInThrough(browser, walker, 'notified');
    const id = psql(
      `select u.subject_id from users u join tenants t on t.id = u.tenant_id where t.name = ${sqlText(TENANT)} and u.username = ${sqlText(walker.username)}`,
    );
    await page.goto(`/console/${TENANT}/subjects/${id}?tab=sessions`);
    await page.getByRole('button', { name: 'End every session' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'End every session' }).click();
  }
  const queued = (): string =>
    psql(
      `select count(*) from backchannel_logout_deliveries where client_id = ${sqlText(clientId('notified'))}::uuid`,
    );
  await expect.poll(queued).toBe('2');
  sendLogouts();
  await expect
    .poll(() =>
      psql(
        `select count(*) from backchannel_logout_deliveries where client_id = ${sqlText(clientId('notified'))}::uuid and delivered_at is null and attempts >= 5 and last_error is not null`,
      ),
    )
    .toBe('2');

  await openClient(page, 'notified', 'logout');
  const section = page.getByRole('region', { name: 'Back-channel deliveries' });
  const table = section.getByRole('grid', { name: /^Logout deliveries of / });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByText('failed')).toHaveCount(2);
  await expect(table).toContainText('https://127.0.0.1:9/backchannel');
  await expectAccessible(page);

  await section.getByRole('button', { name: /Show/u }).click();
  await page.getByRole('option', { name: 'Delivered' }).click();
  await expect(section.getByText('No logout token has been queued for this client.')).toBeVisible();
  await section.getByRole('button', { name: /Show/u }).click();
  await page.getByRole('option', { name: 'Failed' }).click();
  await expect(section.getByRole('grid').getByRole('row')).toHaveCount(3);
  await expectAccessible(page);
});

test('a lifetime is changed by keyboard alone', async ({ page }) => {
  await signIn(page, admin);
  await openClient(page, 'kbtokens', 'tokens');
  const lifetimes = page.getByRole('region', { name: 'Token lifetimes' });
  const toggle = lifetimes.getByRole('switch', { name: "Use the tenant's access token lifetime" });
  await tabTo(page, toggle);
  await page.keyboard.press('Space');
  const field = lifetimes.getByRole('textbox', { name: 'Access token lifetime, in seconds' });
  await tabTo(page, field);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('1200');
  await page.keyboard.press('Tab');
  await expect(lifetimes.getByText('1200 s · 20 minutes')).toBeVisible();
  const save = lifetimes.getByRole('button', { name: 'Save Token lifetimes' });
  await tabTo(page, save);
  await page.keyboard.press('Enter');
  await expect.poll(() => configColumn('kbtokens', 'access_token_ttl_seconds')).toBe('1200');
  await expectAccessible(page);
});

test('an audience is added by keyboard alone', async ({ page }) => {
  await signIn(page, admin);
  await openClient(page, 'kbadvanced', 'advanced');
  const section = page.getByRole('region', { name: 'Audiences' });
  const add = section.getByRole('button', { name: 'Add audience' });
  await tabTo(page, add);
  await page.keyboard.press('Enter');
  await expect(section.getByRole('textbox', { name: 'Audience 1' })).toBeFocused();
  await page.keyboard.type('https://api.keyboard.example');
  const save = section.getByRole('button', { name: 'Save Audiences' });
  await tabTo(page, save);
  await page.keyboard.press('Enter');
  await expect
    .poll(() => configList('kbadvanced', 'audiences'))
    .toBe('https://api.keyboard.example');
  await expectAccessible(page);
});

test('a lifetime changed behind an open page is shown beside yours, and keeping yours saves it', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await openClient(page, 'racedtokens', 'tokens');
  const lifetimes = page.getByRole('region', { name: 'Token lifetimes' });
  await lifetimes.getByText("Use the tenant's access token lifetime", { exact: true }).click();
  const field = lifetimes.getByRole('textbox', { name: 'Access token lifetime, in seconds' });
  await field.fill('900');
  await field.press('Tab');
  psql(
    `update client_oidc_config set access_token_ttl_seconds = 1800 where client_id = ${sqlText(clientId('racedtokens'))}::uuid`,
  );
  await lifetimes.getByRole('button', { name: 'Save Token lifetimes' }).click();
  await expect(lifetimes.getByText(/changed elsewhere/u).first()).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/clients/${clientId('racedtokens')}`);
  expect(configColumn('racedtokens', 'access_token_ttl_seconds')).toBe('1800');
  await lifetimes.getByRole('button', { name: 'Keep mine in Token lifetimes' }).click();
  await expect.poll(() => configColumn('racedtokens', 'access_token_ttl_seconds')).toBe('900');
});

test('audiences changed behind an open page are shown beside yours, and taking theirs keeps theirs', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await openClient(page, 'racedadvanced', 'advanced');
  const section = page.getByRole('region', { name: 'Audiences' });
  await section.getByRole('button', { name: 'Add audience' }).click();
  await section.getByRole('textbox', { name: 'Audience 1' }).fill('https://mine.example');
  psql(
    `update client_oidc_config set audiences = '{https://theirs.example}' where client_id = ${sqlText(clientId('racedadvanced'))}::uuid`,
  );
  await section.getByRole('button', { name: 'Save Audiences' }).click();
  await expect(section.getByText(/changed elsewhere/u).first()).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/clients/${clientId('racedadvanced')}`);
  expect(configList('racedadvanced', 'audiences')).toBe('https://theirs.example');
  await section.getByRole('button', { name: 'Take theirs in Audiences' }).click();
  await expect(section.getByRole('textbox', { name: 'Audience 1' })).toHaveValue(
    'https://theirs.example',
  );
  expect(configList('racedadvanced', 'audiences')).toBe('https://theirs.example');
});

const PHONE_TABS: readonly { tab: string; ready: (page: Page) => Promise<void> }[] = [
  {
    tab: 'tokens',
    ready: (page) => expect(page.getByRole('region', { name: 'Token lifetimes' })).toBeVisible(),
  },
  {
    tab: 'scopes',
    ready: (page) => expect(page.getByRole('region', { name: 'Assigned scopes' })).toBeVisible(),
  },
  {
    tab: 'logout',
    ready: (page) => expect(page.getByRole('region', { name: 'After sign-out' })).toBeVisible(),
  },
  {
    tab: 'advanced',
    ready: (page) => expect(page.getByRole('region', { name: 'Client secret' })).toBeVisible(),
  },
  {
    tab: 'roles',
    ready: (page) => expect(page.getByRole('region', { name: 'New role' })).toBeVisible(),
  },
  {
    tab: 'service',
    ready: (page) => expect(page.getByRole('option').first()).toBeVisible(),
  },
  {
    tab: 'sessions',
    ready: (page) => expect(page.getByRole('region', { name: 'Revoke every token' })).toBeVisible(),
  },
];

for (const { tab, ready } of PHONE_TABS) {
  test(`the ${tab} tab fits a phone`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(PHONE);
    await signIn(page, admin);
    for (const key of ['ledger', UNBROKEN]) {
      await openClient(page, key, tab);
      await ready(page);
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      await expect(page.locator('[role="status"]', { hasText: /^Loading/u })).toHaveCount(0);
      await expectFitsViewport(page, `${tab} of ${key}`);
      await expectAccessible(page);
    }
  });
}
