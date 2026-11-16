import type { Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectFitsViewport,
  signIn,
  tabsWithin,
  test,
  PHONE,
} from './fixtures';
import { inTenant, psql, seeded } from './stack';

const { lockouts } = seeded().config;

function failures(tenant: string): number {
  return Number(psql(`select count(*) from login_failures where tenant_id = ${inTenant(tenant)}`));
}

async function openSettings(page: Page, tenant: string): Promise<void> {
  await page.goto(`/console/${tenant}/settings`);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
}

test('every lockout in a tenant is cleared by typing its name, and the clear is audited', async ({
  page,
}) => {
  test.slow();
  const { main } = lockouts;
  await signIn(page, main);
  await openSettings(page, main.tenant);
  expect(failures(main.tenant)).toBe(3);
  const zone = page.getByRole('region', { name: 'Clear all lockouts' });
  await expect(zone).toBeVisible();
  await expectAccessible(page);

  await zone.getByRole('button', { name: 'Clear all lockouts' }).click();
  const dialog = page.getByRole('alertdialog', {
    name: `Clear all lockouts in ${main.tenant}?`,
  });
  await expect(dialog).toContainText('every wrong password and every wrong second factor');
  await expect(dialog).toContainText('try again at once');
  const confirm = dialog.getByRole('button', { name: 'Clear all lockouts' });
  await expect(confirm).toBeDisabled();
  await expectAccessible(page);
  await dialog.getByRole('textbox').fill(main.tenant);
  await confirm.click();

  await expect(
    page.getByText(`Cleared the failed sign-ins of 3 accounts in ${main.tenant}.`),
  ).toBeVisible();
  await expect.poll(() => failures(main.tenant)).toBe(0);
  expect(
    psql(
      `select count(*) from audit_events where tenant_id = ${inTenant(main.tenant)} and action = 'subject.lockouts_clear' and (detail ->> 'cleared')::int = 3`,
    ),
  ).toBe('1');
  await expectAccessible(page);
});

test('every lockout is cleared by keyboard alone', async ({ page }) => {
  test.slow();
  const { keyed } = lockouts;
  await signIn(page, keyed);
  await openSettings(page, keyed.tenant);
  const nav = page.getByRole('navigation', { name: 'On this page' });
  await nav.getByRole('link', { name: 'Brute force' }).press('Enter');
  const button = page.getByRole('button', { name: 'Clear all lockouts' });
  await tabsWithin(40)(page, button);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', {
    name: `Clear all lockouts in ${keyed.tenant}?`,
  });
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await page.keyboard.type(keyed.tenant);
  await page.keyboard.press('Enter');
  await expect.poll(() => failures(keyed.tenant)).toBe(0);
  await expect(
    page.getByText(`Cleared the failed sign-ins of 3 accounts in ${keyed.tenant}.`),
  ).toBeVisible();
  await expectAccessible(page);
});

test('an operator holding manage-tenant alone is told what the clear needs, and is offered none', async ({
  page,
}) => {
  const { fixed, fixedTenantOnly } = lockouts;
  await signIn(page, fixedTenantOnly);
  await openSettings(page, fixed.tenant);
  const zone = page.getByRole('region', { name: 'Clear all lockouts' });
  await expect(zone.getByRole('note')).toHaveText(
    'Clearing every lockout needs the manage-users capability.',
  );
  await expect(zone.getByRole('button')).toHaveCount(0);
  await expectAccessible(page);
});

test('the clear and its confirmation fit a phone', async ({ page }) => {
  test.slow();
  await page.setViewportSize(PHONE);
  const { fixed } = lockouts;
  await signIn(page, fixed);
  await openSettings(page, fixed.tenant);
  await expectFitsViewport(page, 'settings');
  await page.getByRole('button', { name: 'Clear all lockouts' }).click();
  const dialog = page.getByRole('alertdialog', { name: `Clear all lockouts in ${fixed.tenant}?` });
  await expect(dialog).toBeVisible();
  await expectFitsViewport(page, 'settings');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
