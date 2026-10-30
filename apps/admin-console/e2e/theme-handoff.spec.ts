import type { Page } from '@playwright/test';
import { chooseTheme, expectSignedOut, expect, expectAccessible, signIn, test } from './fixtures';
import { seeded } from './stack';

const { admin } = seeded();

// The server-rendered sign-in runs no script, so the colour it takes is the
// one its markup names, which is the one the odudu-theme cookie held.
async function signOutToServerPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expectSignedOut(page);
}

const colorScheme = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

const themeCookie = async (page: Page): Promise<string | undefined> =>
  (await page.context().cookies()).find((cookie) => cookie.name === 'odudu-theme')?.value;

test('light chosen in the console holds on the sign-in page after signing out, over a dark system', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page, admin);
  await chooseTheme(page, 'Light');
  expect(await themeCookie(page)).toBe('light');

  await signOutToServerPage(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await colorScheme(page)).toBe('light');
  await expectAccessible(page);
});

test('dark chosen in the console holds on the sign-in page after signing out, over a light system', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await signIn(page, admin);
  await chooseTheme(page, 'Dark');
  expect(await themeCookie(page)).toBe('dark');

  await signOutToServerPage(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await colorScheme(page)).toBe('dark');
  await expectAccessible(page);
});

test('the system choice clears the cookie, so the sign-in page follows the system again', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page, admin);
  await chooseTheme(page, 'Light');
  expect(await themeCookie(page)).toBe('light');
  await chooseTheme(page, 'System');
  expect(await themeCookie(page)).toBeUndefined();

  await signOutToServerPage(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./u);
  expect(await colorScheme(page)).toBe('light dark');
  await expectAccessible(page);
});

test('a choice stored before the cookie existed reaches the sign-in page on the next visit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('odudu.console.theme', 'light');
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page, admin);
  expect(await themeCookie(page)).toBe('light');
  await signOutToServerPage(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
