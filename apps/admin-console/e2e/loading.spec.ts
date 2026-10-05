import type { Page } from '@playwright/test';
import { expect, expectAccessible, signIn, test } from './fixtures.ts';
import { seeded } from './stack.ts';

const { admin } = seeded().subjects;
const TENANT = admin.tenant;
const SLOW_MS = 800;

// Holds the session read open until the test lets it go, so the page is
// inspected while the console is still waiting.
async function holdSession(page: Page): Promise<() => void> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/console/api/session', async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

async function recordCard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { card: false };
    Object.assign(window, { seen });
    const look = (): void => {
      if (document.querySelector('main h1')?.textContent === 'Odudu console') seen.card = true;
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true });
  });
}

async function cardSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const seen: unknown = Reflect.get(window, 'seen');
    return typeof seen === 'object' && seen !== null && Reflect.get(seen, 'card') === true;
  });
}

test('a reload of a tenant page holds the console frame, then fills it in place', async ({
  page,
}) => {
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/subjects`);
  await expect(page.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();

  await recordCard(page);
  const release = await holdSession(page);
  const reload = page.reload();
  const placeholder = page.locator('[data-shape="table"]');
  await expect(placeholder).toBeVisible({ timeout: SLOW_MS + 5000 });
  await expect(page.getByRole('status')).toHaveCount(1);
  // The shimmer is what axe cannot measure a contrast against.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectAccessible(page);

  const during = await page.locator('main').boundingBox();
  const railDuring = await page.getByRole('region', { name: 'Menu' }).boundingBox();
  release();
  await reload;
  await expect(page.getByRole('navigation', { name: `Areas of ${TENANT}` })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();

  const after = await page.locator('main').boundingBox();
  const railAfter = await page.getByRole('region', { name: 'Menu' }).boundingBox();
  for (const [then, now] of [
    [during, after],
    [railDuring, railAfter],
  ] as const) {
    if (then === null || now === null) throw new Error('the region has no box');
    expect(Math.abs(then.x - now.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(then.y - now.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(then.width - now.width)).toBeLessThanOrEqual(2);
  }
  expect(await cardSeen(page)).toBe(false);
});
