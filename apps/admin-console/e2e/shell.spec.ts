import type { Page } from '@playwright/test';
import { expect, expectAccessible, forgive, sessionTenant, signIn, test } from './fixtures.ts';
import { seeded } from './stack.ts';

const { admin, system } = seeded();
const PHONE = { width: 390, height: 844 };

async function backgroundLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement('canvas').getContext('2d');
    if (probe === null) throw new Error('no canvas');
    probe.fillStyle = getComputedStyle(document.body).backgroundColor;
    probe.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
}

// React Aria keeps the radio input itself out of reach of the pointer.
async function chooseTheme(page: Page, name: string): Promise<void> {
  await page.getByRole('radiogroup', { name: 'Theme' }).getByText(name, { exact: true }).click();
  await expect(page.getByRole('radio', { name })).toBeChecked();
}

test('the rail collapses and expands on [, remembered across a reload', async ({ page }) => {
  await signIn(page, system);
  await page.goto(`/console/${admin.tenant}`);
  const rail = page.getByRole('region', { name: 'Menu' });
  const bar = page.getByRole('region', { name: 'System authority' });
  await expect(rail).toBeVisible();
  await expect(bar).toBeVisible();

  await page.keyboard.press('[');
  await expect(rail).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible();
  await expect(bar).toBeVisible();
  await expectAccessible(page);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(rail).toBeHidden();
  await expect(bar).toBeVisible();

  await page.getByRole('button', { name: 'Expand menu' }).click();
  await expect(rail).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse menu' })).toBeFocused();
  await page.keyboard.press('[');
  await expect(rail).toBeHidden();
  await page.keyboard.press('[');
  await expect(rail).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(rail).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: PHONE });

  test('shows the top bar, and the rail in a menu sheet', async ({ page }) => {
    await signIn(page, admin);
    await expect(page.getByRole('region', { name: 'Menu' })).toBeHidden();
    await expect(page.getByRole('banner')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Menu' }).click();
    const sheet = page.getByRole('dialog', { name: 'Navigation' });
    await expect(sheet).toBeVisible();
    await expectAccessible(page);

    await page.evaluate(() => {
      document.documentElement.dataset.sameDocument = 'yes';
    });
    await sheet.getByRole('link', { name: 'Audit trail' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(`/console/${admin.tenant}/audit`);
    await expect(page.getByRole('heading', { level: 1, name: 'Audit trail' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-same-document', 'yes');
  });

  test('signs out from the menu sheet', async ({ page }) => {
    await signIn(page, admin);
    await page.getByRole('button', { name: 'Menu' }).click();
    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('button', { name: 'Sign out' })
      .click();

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(await sessionTenant(page)).toBeNull();
  });

  test('announces an error raised while a modal is open', async ({ page, problems }) => {
    await signIn(page, admin);
    let answer: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.route('**/console/auth/logout', async (route) => {
      await held;
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'about:blank', title: 'Service Unavailable', status: 503 }),
      });
    });

    const menu = page.getByRole('button', { name: 'Menu' });
    const sheet = page.getByRole('dialog', { name: 'Navigation' });
    await menu.click();
    await sheet.getByRole('button', { name: 'Sign out' }).click();
    await expect(sheet).toBeHidden();
    await menu.click();
    await expect(sheet).toBeVisible();
    answer();

    const alert = page.getByRole('alert');
    await expect(alert).toHaveText(/Could not sign out/u);
    await expect(sheet).toBeVisible();
    const heard = await alert.evaluate(
      (node) => node.closest('[aria-hidden="true"], [inert]') === null,
    );
    expect(heard).toBe(true);
    forgive(problems, '/console/auth/logout');
  });
});

test('dark mode follows the browser, and a chosen theme overrides it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page, admin);
  expect(await backgroundLuminance(page)).toBeLessThan(0.3);

  await chooseTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await backgroundLuminance(page)).toBeGreaterThan(0.7);

  await page.emulateMedia({ colorScheme: 'light' });
  await chooseTheme(page, 'Dark');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await backgroundLuminance(page)).toBeLessThan(0.3);
  await expectAccessible(page);

  await chooseTheme(page, 'System');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./u);
  expect(await backgroundLuminance(page)).toBeGreaterThan(0.7);
});
