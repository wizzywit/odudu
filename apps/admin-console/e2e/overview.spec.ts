import type { Page } from '@playwright/test';
import { z } from 'zod';
import { expect, expectAccessible, expectFitsViewport, forgive, signIn, test } from './fixtures.ts';
import { psql, seeded } from './stack.ts';

const { admin, limited, overview, system } = seeded();
const PHONE = { width: 390, height: 844 };

const documentSchema = z.looseObject({ issuer: z.string() });
const jwksSchema = z.object({ keys: z.array(z.looseObject({ kid: z.string() })) });

async function publicDocument(page: Page, tail: string): Promise<unknown> {
  const response = await page.request.get(`/tenants/${overview.tenant}/${tail}`);
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  return body;
}

test.beforeAll(() => {
  // Reset on with no relay anywhere in this stack: mail with nowhere to go.
  // Not verification, which would keep its unverified administrator out.
  psql(`update tenants set reset_password_allowed = true where name = '${overview.tenant}'`);
});

test("a tenant administrator's overview says what needs attention and links its fix", async ({
  page,
}) => {
  await signIn(page, overview);
  const attention = page.getByRole('list', { name: 'Needs attention' });
  const mail = attention.getByRole('listitem').filter({ hasText: 'No mail relay' });
  await expect(mail).toContainText('password reset');
  await expect(mail.getByRole('link', { name: 'Open Email' })).toHaveAttribute(
    'href',
    `/console/${overview.tenant}/email`,
  );
  const counts = page.getByRole('region', { name: 'Counts' });
  await expect(counts.getByRole('listitem').filter({ hasText: 'Subjects' })).toContainText(
    /\d+ subjects?/u,
  );
  await expect(counts.getByRole('listitem').filter({ hasText: 'Clients' })).toContainText(
    'allowed',
  );
  await expect(page.getByRole('link', { name: 'Open the audit trail' })).toBeVisible();
  await expectAccessible(page);

  await mail.getByRole('link', { name: 'Open Email' }).click();
  await expect(page).toHaveURL(`/console/${overview.tenant}/email`);
});

test('the discovery panel shows the document and keys relying parties read', async ({ page }) => {
  const document = documentSchema.parse(
    await publicDocument(page, '.well-known/openid-configuration'),
  );
  const jwks = jwksSchema.parse(await publicDocument(page, 'protocol/openid-connect/certs'));
  await signIn(page, overview);

  const panel = page.getByRole('region', { name: 'Discovery', exact: true });
  await expect(panel.getByText(document.issuer, { exact: true })).toBeVisible();
  const endpoints = panel.getByRole('region', { name: 'Endpoints' });
  for (const [name, value] of Object.entries(document)) {
    if (!name.endsWith('_endpoint') && name !== 'jwks_uri') continue;
    await expect(endpoints).toContainText(`${name}${String(value)}`);
  }
  const supported = panel.getByRole('region', { name: 'Supported values' });
  for (const [name, value] of Object.entries(document)) {
    if (!name.endsWith('_supported') || !Array.isArray(value)) continue;
    await expect(supported.getByRole('list', { name })).toHaveText(value.map(String).join(''));
  }
  const keys = panel.getByRole('grid', { name: 'Published keys' });
  await expect(keys.getByRole('row')).toHaveCount(jwks.keys.length + 1);
  for (const key of jwks.keys) {
    await expect(keys.getByRole('row').filter({ hasText: key.kid })).toContainText('active');
  }

  const raw = (summary: string) =>
    panel.locator('details').filter({ has: page.getByText(summary, { exact: true }) });
  await panel.getByText('Raw discovery document').click();
  const shownDocument: unknown = JSON.parse(
    await raw('Raw discovery document').locator('pre').innerText(),
  );
  expect(shownDocument).toEqual(document);
  await panel.getByText('Raw JWKS').click();
  const shownKeys: unknown = JSON.parse(await raw('Raw JWKS').locator('pre').innerText());
  expect(shownKeys).toEqual(jwks);
  await expectAccessible(page);
});

test('the issuer can be copied by keyboard alone', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, overview);
  const issuer = documentSchema.parse(
    await publicDocument(page, '.well-known/openid-configuration'),
  ).issuer;
  const copy = page.getByRole('button', { name: 'Copy issuer' });
  await expect(copy).toBeVisible();
  let reached = false;
  for (let press = 0; press < 80 && !reached; press += 1) {
    await page.keyboard.press('Tab');
    reached = await copy.evaluate((button) => button === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Copied issuer' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(issuer);
});

test('an operator without view-audit sees neither the audit rows nor the areas it cannot read', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    asked.push(new URL(request.url()).pathname);
  });
  await signIn(page, limited);
  const rail = page.getByRole('navigation', { name: `Areas of ${limited.tenant}` });
  await expect(rail.getByRole('link')).toHaveText([
    'Overview',
    'Groups',
    'Roles',
    'Scopes',
    'Sign-in flow',
    'Settings',
    'Email',
    'Export',
    'Switch tenant',
  ]);
  await expect(page.getByRole('region', { name: 'Counts' }).getByRole('link')).toHaveText([
    'Groups',
    'Roles',
    'Scopes',
  ]);
  await expect(page.getByRole('region', { name: 'Latest activity' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Create|Delete|Save)/u })).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Needs attention' }).getByRole('note'),
  ).toContainText('manage-keys');
  await expect(
    page.getByRole('region', { name: 'Discovery', exact: true }).getByRole('note'),
  ).toContainText("Each key's lane needs the manage-keys capability.");
  await expectAccessible(page);
  const api = `/console/api/admin/tenants/${limited.tenant}`;
  expect(asked).not.toContain(`${api}/audit`);
  expect(asked).not.toContain(`${api}/keys`);
});

test('a system administrator opening a tenant that does not exist is told so', async ({
  page,
  problems,
}) => {
  await signIn(page, system);
  await page.goto('/console/no-such-tenant-here');
  await expect(page.getByRole('heading', { level: 1, name: 'Tenant not found' })).toBeVisible();
  await expect(page.getByText('No tenant is named no-such-tenant-here.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Areas of no-such-tenant-here' })).toHaveCount(
    0,
  );
  await expectAccessible(page);
  forgive(problems, '/console/api/admin/tenants/no-such-tenant-here/whoami');
});

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('lays the overview out in one column with nothing wider than the screen', async ({
    page,
  }) => {
    await signIn(page, admin);
    await expect(page.getByRole('button', { name: 'Copy issuer' })).toBeVisible();
    await expectFitsViewport(page);
    await page.getByText('Raw discovery document').click();
    await expectAccessible(page);
  });
});
