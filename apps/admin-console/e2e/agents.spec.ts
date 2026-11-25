import { expect, expectAccessible, expectFitsViewport, signIn, test, PHONE } from './fixtures';
import { seeded } from './stack';

const { admin, tenantOnly } = seeded().access.tokens;
const TENANT = admin.tenant;

test('the agents and their approvals are listed, empty in a tenant no agent has acted in', async ({
  page,
}) => {
  await signIn(page, admin);
  await page.getByRole('link', { name: 'Agents', exact: true }).click();
  await expect(page).toHaveURL(`/console/${TENANT}/agents`);
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
  await expect(page.getByText('No agents yet')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Approvals' }).click();
  await expect(page).toHaveURL(`/console/${TENANT}/agents/approvals`);
  await expect(page.getByRole('heading', { level: 1, name: 'Agent approvals' })).toBeVisible();
  await expect(page.getByText('No approvals yet')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('main').getByRole('link', { name: 'Agents' }).click();
  await expect(page).toHaveURL(`/console/${TENANT}/agents`);
});

test('the state filter keeps its place in the address', async ({ page }) => {
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/agents?state=live`);
  await expect(page.getByText('No agents match')).toBeVisible();
  await page.getByRole('button', { name: 'Show every agent' }).click();
  await expect(page.getByText('No agents yet')).toBeVisible();
  await expect(page).not.toHaveURL(/state=/u);
});

test('an operator holding manage-tenant alone is told what the agents need, and has no link to them', async ({
  page,
}) => {
  await signIn(page, tenantOnly);
  await expect(page.getByRole('link', { name: 'Agents', exact: true })).toHaveCount(0);
  await page.goto(`/console/${TENANT}/agents`);
  await expect(page.getByRole('note').filter({ hasText: 'Agents needs' })).toHaveText(
    'Agents needs the manage-sessions capability.',
  );
  await expect(page.getByRole('link', { name: 'Approvals' })).toHaveCount(0);
  await expectAccessible(page);
});

test('the agents page fits a phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/agents`);
  await expect(page.getByText('No agents yet')).toBeVisible();
  await expectFitsViewport(page, 'agents');
  await expectAccessible(page);
});
