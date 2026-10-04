import type { Locator, Page, Route } from '@playwright/test';
import { expect, expectAccessible, signIn, test } from './fixtures.ts';
import { psql, seeded } from './stack.ts';

const { subjects } = seeded();
const { admin } = subjects;
const TENANT = admin.tenant;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function measuredId(): string {
  return psql(
    `select u.subject_id from users u join tenants t on t.id = u.tenant_id where t.name = ${sqlText(TENANT)} and u.username = ${sqlText(subjects.measured)}`,
  );
}

// Every claim filled, the picture on another site so its note shows, and a
// gender in the subject's own words so that box shows too.
function fillProfile(): void {
  psql(
    `update users u set name = 'Mary Somerville', given_name = 'Mary', family_name = 'Somerville', nickname = 'Mary', profile = 'https://example.org/mary', picture = 'https://example.org/mary.png', website = 'https://mary.example', gender = 'in her own words', birthdate = '1780-12-26', zoneinfo = 'Europe/London', locale = 'en-GB', phone_number = '+2348031234567;ext=12', address_formatted = '1 Somerville Road, Jedburgh', address_street = '1 Somerville Road', address_locality = 'Jedburgh', address_postal_code = 'TD8 6AA', address_country = 'United Kingdom' from tenants t where t.id = u.tenant_id and t.name = ${sqlText(TENANT)} and u.username = ${sqlText(subjects.measured)}`,
  );
}

async function openMeasured(page: Page): Promise<string> {
  const id = measuredId();
  await page.goto(`/console/${TENANT}/subjects/${id}`);
  await expect(page.getByRole('region', { name: 'Details' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  return id;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('not rendered');
  return found;
}

// A grid row is the cells sharing one top; each cell's first control stands
// for it.
async function rowsOf(section: Locator): Promise<Map<number, { name: string; control: Box }[]>> {
  const rows = new Map<number, { name: string; control: Box }[]>();
  for (const cell of await section.locator('[data-cell]').all()) {
    const top = Math.round((await box(cell)).y);
    const control = await box(cell.locator('[data-control]').first());
    const name = (await cell.innerText()).split('\n')[0] ?? '';
    rows.set(top, [...(rows.get(top) ?? []), { name, control }]);
  }
  return rows;
}

test.describe('the profile’s fields', () => {
  test.beforeAll(fillProfile);

  test('share one top and one height in every row at 1440 px', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, admin);
    await openMeasured(page);
    for (const title of ['Name', 'Details', 'Address']) {
      const rows = await rowsOf(page.getByRole('region', { name: title }));
      expect(rows.size, title).toBeGreaterThan(1);
      for (const cells of rows.values()) {
        const [first] = cells;
        if (first === undefined) continue;
        for (const cell of cells) {
          expect(
            Math.abs(cell.control.y - first.control.y),
            `${title}: ${cell.name}`,
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(cell.control.height - first.control.height),
            `${title}: ${cell.name}`,
          ).toBeLessThanOrEqual(1);
        }
      }
    }
    // A compound field's parts sit on one line, at the height of any other control.
    const details = page.getByRole('region', { name: 'Details' });
    for (const group of ['Phone number', 'Birthdate']) {
      const parts = await details
        .getByRole('group', { name: group })
        .locator('[data-control]')
        .all();
      expect(parts.length, group).toBeGreaterThan(1);
      const boxes = await Promise.all(parts.map(box));
      const name = await box(page.getByRole('textbox', { name: 'Full name' }));
      for (const part of boxes) {
        expect(Math.abs(part.y - (boxes[0]?.y ?? 0)), group).toBeLessThanOrEqual(1);
        expect(Math.abs(part.height - name.height), group).toBeLessThanOrEqual(1);
      }
    }
    await expectAccessible(page);
  });

  test('never scroll sideways at 390 px', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, admin);
    await openMeasured(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      PHONE.width,
    );
    for (const title of ['Name', 'Details', 'Address']) {
      const section = page.getByRole('region', { name: title });
      const edge = await box(section);
      for (const control of await section.locator('[data-control]').all()) {
        const { x, width } = await box(control);
        expect(x + width, title).toBeLessThanOrEqual(edge.x + edge.width);
      }
    }
    await expectAccessible(page);
  });
});

// Holds every request a pattern matches until `release` is called, so a test
// can measure what stands in for the answer.
async function hold(page: Page, path: string): Promise<() => Promise<void>> {
  const held: Route[] = [];
  let open = false;
  const at = `/console/api/admin/tenants/${TENANT}/${path}`;
  await page.route(
    (url) => url.pathname === at,
    async (route) => {
      if (open) await route.continue();
      else held.push(route);
    },
  );
  return async () => {
    open = true;
    await Promise.all(held.map((route) => route.continue()));
  };
}

const NEAR = 3;

test.describe('a placeholder takes the height of what it stands for', () => {
  test.beforeAll(fillProfile);

  test('a table row', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, admin);
    const release = await hold(page, 'subjects');
    await page.goto(`/console/${TENANT}/subjects`);
    const loading = page.getByRole('status').filter({ hasText: 'Loading subjects' });
    const placeholder = await box(loading.locator('tbody tr').first());
    await release();
    await expect(loading).toHaveCount(0);
    const row = await box(page.getByRole('row').filter({ hasText: subjects.measured }));
    expect(Math.abs(placeholder.height - row.height)).toBeLessThanOrEqual(NEAR);
  });

  test('a field, and a section’s heading', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, admin);
    const id = measuredId();
    const release = await hold(page, `subjects/${id}/profile`);
    await page.goto(`/console/${TENANT}/subjects/${id}`);
    const loading = page.getByRole('status').filter({ hasText: 'Loading the profile' });
    const field = loading.locator('[data-part="field"]').first();
    const placeholder = {
      field: await box(field),
      label: await box(field.locator('[data-size="label"]')),
      control: await box(field.locator('[data-size="field"]')),
    };
    await release();
    await expect(loading).toHaveCount(0);
    const name = page.getByRole('region', { name: 'Name' });
    const cell = name.locator('[data-cell]').first();
    const real = {
      field: await box(cell),
      label: await box(cell.getByText('Full name', { exact: true })),
      control: await box(cell.locator('[data-control]')),
    };
    expect(Math.abs(placeholder.label.height - real.label.height)).toBeLessThanOrEqual(NEAR);
    expect(Math.abs(placeholder.control.height - real.control.height)).toBeLessThanOrEqual(NEAR);
    expect(Math.abs(placeholder.field.height - real.field.height)).toBeLessThanOrEqual(NEAR);
  });

  test('a record’s section heading', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, admin);
    const id = measuredId();
    const release = await hold(page, `subjects/${id}`);
    await page.goto(`/console/${TENANT}/subjects/${id}`);
    const loading = page.getByRole('status').filter({ hasText: /^Loading/u });
    const heading = await box(loading.locator('[data-size="heading"]').first());
    await release();
    await expect(loading).toHaveCount(0);
    const real = await box(page.getByRole('heading', { level: 2, name: 'Account' }));
    expect(Math.abs(heading.height - real.height)).toBeLessThanOrEqual(NEAR);
  });

  test('a count tile', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const release = await hold(page, 'subjects/count');
    await signIn(page, admin);
    const tile = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'Subjects', exact: true }) })
      .filter({ hasText: /Counting|subject/u });
    await expect(tile.getByText('Counting…')).toBeAttached();
    const placeholder = await box(tile);
    await release();
    await expect(tile.getByText('Counting…')).toHaveCount(0);
    const real = await box(tile);
    expect(Math.abs(placeholder.height - real.height)).toBeLessThanOrEqual(NEAR);
  });
});
