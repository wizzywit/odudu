import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, expectFitsViewport, PHONE, signIn, test } from './fixtures';
import { inTenant, psql, seededDomainHost, seeded } from './stack';

const { domains } = seeded().access;

function canonicalOf(tenant: string): string {
  return psql(
    `select coalesce((select host from tenant_domains where canonical and tenant_id = ${inTenant(tenant)}), 'path')`,
  );
}

function stateOf(tenant: string, host: string): string {
  return psql(
    `select coalesce((select state from tenant_domains where host = '${host}' and tenant_id = ${inTenant(tenant)}), 'none')`,
  );
}

async function openDomains(page: Page, tenant: string): Promise<void> {
  await page.goto(`/console/${tenant}/domains`);
  await expect(page.getByRole('heading', { level: 1, name: 'Domains' })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Domains' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
}

function row(page: Page, host: string): Locator {
  return page
    .getByRole('grid', { name: 'Domains' })
    .getByRole('row', { name: new RegExp(host, 'u') });
}

test('a domain is registered and its record shown, then a verified one is made the address and switched back', async ({
  page,
  context,
}) => {
  test.slow();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { main } = domains;
  const verified = seededDomainHost(main.tenant);
  const fresh = `fresh.${main.tenant}.acme.org`;
  await signIn(page, main);
  await openDomains(page, main.tenant);
  await expect(page.getByText('This tenant signs in at its path address.')).toBeVisible();
  await expect(row(page, verified)).toContainText('Verified');
  await expect(row(page, verified)).toContainText('Not in use');
  await expectAccessible(page);

  await page.getByRole('textbox', { name: 'Host' }).fill(fresh);
  await page.getByRole('button', { name: 'Register domain' }).click();
  await expect(row(page, fresh)).toContainText('Pending');
  const recordName = `_odudu-challenge.${fresh}`;
  await expect(page.getByText(recordName, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Copy TXT record name for ${fresh}` }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Copied TXT record name' }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(recordName);
  await page.getByRole('button', { name: `Copy TXT record value for ${fresh}` }).click();
  const value = await page.evaluate(() => navigator.clipboard.readText());
  expect(value.length).toBeGreaterThan(8);
  await expect(page.getByText(value, { exact: true })).toBeVisible();
  await expectAccessible(page);

  // The stack has no DNS, so the record can never be seen: a verification
  // does not land, and the domain stays pending.
  await page.getByRole('button', { name: `Verify ${fresh}` }).click();
  await expect(page.getByRole('status', { name: 'Last verification' })).toContainText(
    'does not show its record yet',
  );
  await expect(row(page, fresh)).toContainText('Pending');
  await expect(row(page, fresh)).not.toContainText('Verified');
  expect(stateOf(main.tenant, fresh)).not.toBe('verified');
  await page.getByRole('button', { name: `Remove ${fresh}` }).click();
  await page
    .getByRole('alertdialog', { name: `Remove ${fresh}?` })
    .getByRole('button', { name: 'Remove domain' })
    .click();
  await expect(row(page, fresh)).toHaveCount(0);
  expect(stateOf(main.tenant, fresh)).toBe('none');

  await page.getByRole('button', { name: `Make ${verified} the address` }).click();
  const activate = page.getByRole('alertdialog', {
    name: `Make ${verified} the tenant’s address?`,
  });
  await expect(activate).toContainText('1 hour');
  await expect(activate).toContainText('sign in again');
  await expect(activate).toContainText('1 subject holds a passkey');
  const confirm = activate.getByRole('button', { name: 'Make it the address' });
  await expect(confirm).toBeDisabled();
  await expectAccessible(page);
  // A checkbox is pressed through its label, which is the box that takes the pointer.
  await activate.getByText(/I understand these passkeys/u).click();
  await expect(activate.getByRole('checkbox')).toBeChecked();
  await expect(confirm).toBeEnabled();
  await expectAccessible(page);
  await confirm.click();
  await expect(page.getByRole('status', { name: 'Last domain action' })).toContainText(
    `${verified} is now the tenant’s address.`,
  );
  expect(canonicalOf(main.tenant)).toBe(verified);
  await expect(row(page, verified)).toContainText('Current address');
  await expect(row(page, verified).getByRole('button', { name: /Remove/u })).toHaveCount(0);
  await expect(page.getByText(`This tenant signs in at ${verified}.`)).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: `Switch back from ${verified}` }).click();
  const back = page.getByRole('alertdialog', { name: 'Switch back to the path address?' });
  await expect(back).toContainText('path address');
  await expectAccessible(page);
  await back.getByRole('button', { name: 'Switch back' }).click();
  await expect(page.getByRole('status', { name: 'Last domain action' })).toContainText(
    'The tenant signs in at its path address again.',
  );
  expect(canonicalOf(main.tenant)).toBe('path');
  await expect(row(page, verified)).toContainText('Not in use');
  await expectAccessible(page);
});

test('an operator holding view-domains alone sees the domains and no control, at a phone width too', async ({
  page,
}) => {
  const { fixed, fixedViewOnly } = domains;
  await signIn(page, fixedViewOnly);
  await openDomains(page, fixed.tenant);
  await expect(page.getByRole('note').filter({ hasText: 'manage-domains' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register domain' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Make .* the address$/u })).toHaveCount(0);
  await expectAccessible(page);
  await page.setViewportSize(PHONE);
  await openDomains(page, fixed.tenant);
  await expectFitsViewport(page);
  await expectAccessible(page);
});
