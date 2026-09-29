import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, signIn, test } from './fixtures.ts';
import { psql, seeded } from './stack.ts';

const { admin, subjects, system, tenants } = seeded();
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1440, height: 900 };
const WIDE = { width: 2560, height: 1440 };

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function subjectId(tenant: string, username: string): string {
  return psql(
    `select u.subject_id from users u join tenants t on t.id = u.tenant_id where t.name = ${sqlText(tenant)} and u.username = ${sqlText(username)}`,
  );
}

async function box(locator: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error(`${locator.toString()} has no box`);
  return { x: found.x, y: found.y, w: found.width, h: found.height };
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

function breadcrumb(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Breadcrumb' });
}

test.describe('the breadcrumb', () => {
  test('climbs from a tenant record back to Tenants', async ({ page }) => {
    await signIn(page, system);
    await page.goto(`/console/system/tenants/${tenants.general}`);
    await expect(page.getByRole('heading', { level: 1, name: tenants.general })).toBeVisible();
    const trail = breadcrumb(page);
    await expect(trail.getByRole('listitem')).toHaveText(['System›', 'Tenants›', tenants.general]);
    await expect(trail.getByText(tenants.general)).toHaveAttribute('aria-current', 'page');
    await expect(trail.getByRole('link', { name: /^Back to/u })).toBeHidden();
    await expectAccessible(page);

    await trail.getByRole('link', { name: 'Tenants' }).click();
    await expect(page).toHaveURL('/console/system/tenants');
    await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible();
    await expect(breadcrumb(page)).toHaveCount(0);
  });

  test('climbs from a subject record back to the subjects', async ({ page }) => {
    await signIn(page, subjects.admin);
    const tenant = subjects.admin.tenant;
    const username = subjects.viewer.username;
    await page.goto(`/console/${tenant}/subjects/${subjectId(tenant, username)}`);
    await expect(page.getByRole('heading', { level: 1, name: username })).toBeVisible();
    const trail = breadcrumb(page);
    await expect(trail.getByText(username)).toHaveAttribute('aria-current', 'page');

    await trail.getByRole('link', { name: 'Subjects' }).click();
    await expect(page).toHaveURL(`/console/${tenant}/subjects`);
    await expect(page.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE });

    test('collapses to a single way up, and never scrolls sideways', async ({ page }) => {
      await signIn(page, system);
      await page.goto(`/console/system/tenants/${tenants.general}`);
      await expect(page.getByRole('heading', { level: 1, name: tenants.general })).toBeVisible();
      const trail = breadcrumb(page);
      await expect(trail.getByRole('list')).toBeHidden();
      const up = trail.getByRole('link', { name: 'Back to Tenants' });
      await expect(up).toBeVisible();
      await expect(up).toHaveText('‹ Tenants');
      await noSidewaysScroll(page);
      await expectAccessible(page);

      await up.click();
      await expect(page).toHaveURL('/console/system/tenants');
      await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible();
    });
  });
});

test('the rail lights Tenants on its creation and import pages', async ({ page }) => {
  await signIn(page, system);
  const rail = page.getByRole('navigation', { name: 'Areas of system' });
  for (const [at, title] of [
    ['/console/system/new-tenant', 'Create a tenant'],
    ['/console/system/import-tenant', 'Import a tenant'],
  ] as const) {
    await page.goto(at);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(rail.locator('[aria-current="page"]')).toHaveText('Tenants');
  }
});

test.describe('the way back to system', () => {
  async function enterAndReturn(page: Page): Promise<void> {
    await signIn(page, system);
    await page.goto(`/console/${admin.tenant}`);
    const bar = page.getByRole('region', { name: 'System authority' });
    await expect(bar).toContainText(`Acting in ${admin.tenant} with system authority`);
    const back = bar.getByRole('link', { name: 'Back to system' });
    await expect(back).toBeVisible();
    await expectAccessible(page);

    await back.click();
    await expect(page).toHaveURL(`/console/system/tenants/${admin.tenant}`);
    await expect(page.getByRole('heading', { level: 1, name: admin.tenant })).toBeVisible();
    await expect(page.getByRole('region', { name: 'System authority' })).toHaveCount(0);
  }

  test('leads from a tenant entered to its record under System › Tenants', async ({ page }) => {
    await enterAndReturn(page);
  });

  test('is there with the rail collapsed', async ({ page }) => {
    await signIn(page, system);
    await page.goto(`/console/${admin.tenant}`);
    await expect(page.getByRole('region', { name: 'Menu' })).toBeVisible();
    await page.keyboard.press('[');
    await expect(page.getByRole('region', { name: 'Menu' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Back to system' })).toBeVisible();
    await page.keyboard.press('[');
    await expect(page.getByRole('region', { name: 'Menu' })).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE });

    test('is there too, by keyboard', async ({ page }) => {
      await signIn(page, system);
      await page.goto(`/console/${admin.tenant}`);
      const back = page.getByRole('link', { name: 'Back to system' });
      await expect(back).toBeVisible();
      await noSidewaysScroll(page);
      await back.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`/console/system/tenants/${admin.tenant}`);
    });
  });
});

// Every control in the bar on one line shares that line's centre.
async function expectOneCentreLine(page: Page, singleRow: boolean): Promise<void> {
  const bar = page.getByRole('search', { name: 'Filter system administrators' });
  const controls = [
    bar.locator('[data-fixed]'),
    bar.getByRole('searchbox'),
    bar.getByRole('button', { name: 'Search', exact: true }),
    bar.locator('kbd'),
    bar.getByRole('button', { name: /Status/u }),
    bar.getByText(/^\d+\+? system administrators?$/u),
    bar.getByRole('button', { name: 'Clear filters' }),
  ];
  const boxes = await Promise.all(controls.map(box));
  expect(new Set(boxes.slice(0, 5).map((b) => Math.round(b.h)))).toEqual(new Set([32]));
  const rows: { first: number; centres: number[] }[] = [];
  for (const b of boxes) {
    const centre = b.y + b.h / 2;
    const row = rows.find((r) => Math.abs(r.first - centre) < 16);
    if (row === undefined) rows.push({ first: centre, centres: [centre] });
    else row.centres.push(centre);
  }
  if (singleRow) expect(rows).toHaveLength(1);
  for (const { centres } of rows) {
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1);
  }
}

async function openNarrowedAdministrators(page: Page): Promise<void> {
  await signIn(page, system);
  await page.goto('/console/system/system-admins?enabled=true');
  await expect(page.getByRole('grid', { name: 'System administrators' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
}

test.describe('the filter bar', () => {
  test.describe('on a laptop', () => {
    test.use({ viewport: LAPTOP });

    test('puts every control on one line, one height', async ({ page }) => {
      await openNarrowedAdministrators(page);
      await expectOneCentreLine(page, true);
      await expectAccessible(page);
    });
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE });

    test('wraps, each line sharing one centre', async ({ page }) => {
      await openNarrowedAdministrators(page);
      await expectOneCentreLine(page, false);
      await noSidewaysScroll(page);
    });
  });
});

test.describe('the page width', () => {
  async function measure(page: Page) {
    await signIn(page, system);
    const main = await box(page.getByRole('main'));
    const rail = await box(page.getByRole('region', { name: 'Menu' }));
    const width = page.viewportSize()?.width ?? 0;
    return { main, beside: width - (rail.x + rail.w), railEnd: rail.x + rail.w, width };
  }

  test.describe('on a laptop', () => {
    test.use({ viewport: LAPTOP });

    test('fills the space beside the rail', async ({ page }) => {
      const { main, beside } = await measure(page);
      expect(Math.abs(main.w - beside)).toBeLessThanOrEqual(1);
    });
  });

  test.describe('on a very wide screen', () => {
    test.use({ viewport: WIDE });

    test('stops at its cap and is centred', async ({ page }) => {
      const { main, railEnd, width } = await measure(page);
      expect(Math.round(main.w)).toBe(1600);
      const before = main.x - railEnd;
      const after = width - (main.x + main.w);
      expect(Math.abs(before - after)).toBeLessThanOrEqual(1);
    });
  });
});

test('shows a long discovery name in full', async ({ page }) => {
  await signIn(page, admin);
  const term = page.getByText('id_token_signing_alg_values_supported', { exact: true });
  await expect(term).toBeVisible();
  const clipped = await term.evaluate((code) => {
    const cell = code.closest('dt');
    return cell === null ? true : cell.scrollWidth > cell.clientWidth;
  });
  expect(clipped).toBe(false);
});
