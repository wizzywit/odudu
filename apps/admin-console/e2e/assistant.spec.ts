import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, expectFitsViewport, PHONE, signIn, test } from './fixtures';
import { inTenant, psql, seeded, sqlText, type Account } from './stack';

// The model is a stub that replays fixtures (apps/server/src/testing/provider-stub.ts),
// so what is under test is the console and the server around the model.
const accounts = seeded().assistant;
const TENANT = accounts.read.tenant;

function groupsNamed(name: string, tenant = TENANT): number {
  return Number(
    psql(
      `select count(*) from groups where tenant_id = ${inTenant(tenant)} and path = ${sqlText(`/${name}`)}`,
    ),
  );
}

async function openPanel(page: Page, account: Account) {
  await signIn(page, account);
  await page.getByRole('button', { name: 'Ask the assistant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Assistant panel' });
  await expect(panel).toBeVisible();
  return panel;
}

// React Aria keeps the radio input itself out of reach of the pointer.
async function chooseAct(panel: Locator): Promise<void> {
  await panel.getByRole('radiogroup', { name: 'Mode' }).getByText('Act', { exact: true }).click();
  await expect(panel.getByRole('radio', { name: 'Act' })).toBeChecked();
}

async function say(page: Page, text: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: 'Message to the assistant' });
  await composer.fill(text);
  await composer.press('Enter');
}

test('a question is answered with the tool it read, shown as a step with its call', async ({
  page,
}) => {
  const panel = await openPanel(page, accounts.read);
  await expect(panel.getByRole('radio', { name: 'Ask' })).toBeChecked();
  await say(page, 'How many clients?');
  await expect(panel.getByText('I counted the clients with count_clients.')).toBeVisible();
  await expect(panel.getByRole('status', { name: 'Assistant status' })).toHaveText('Finished');
  // Put away once the answer is finished; the call is one press away.
  await panel.getByRole('button', { name: /Show steps/u }).click();
  await expect(panel.getByText('Counted clients')).toBeVisible();
  await panel.getByRole('button', { name: 'Show the call' }).click();
  await expect(panel.getByLabel('The call as sent')).toContainText('"tool": "count_clients"');
  await expectAccessible(page);
});

test('Act proposes a write, the card shows the exact change, and approving makes it', async ({
  page,
}) => {
  const panel = await openPanel(page, accounts.approve);
  await chooseAct(panel);
  await say(page, 'Please approve me');
  const card = panel.getByRole('region', { name: 'Create a group' });
  await expect(card).toBeVisible();
  await expect(card.getByText('e2e-approved', { exact: true }).first()).toBeVisible();
  await expect(card.getByText(`You, as ${accounts.approve.username}`)).toBeVisible();
  await expect(card.getByText(/^Expires in/u)).toBeVisible();
  await expect(panel.getByRole('status', { name: 'Assistant status' })).toHaveText(
    'Approval needed: Create a group',
  );
  // Nothing has been changed, and the card did not take the focus.
  expect(groupsNamed('e2e-approved')).toBe(0);
  await expect(card.getByRole('button', { name: 'Approve' })).not.toBeFocused();
  await expectAccessible(page);

  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card.getByText('Approved by you. The change was made.')).toBeVisible();
  await expect(panel.getByText('The group e2e-approved was created.')).toBeVisible();
  expect(groupsNamed('e2e-approved')).toBe(1);
  await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('refusing a write changes nothing, and the assistant is told', async ({ page }) => {
  const panel = await openPanel(page, accounts.refuse);
  await chooseAct(panel);
  await say(page, 'Please refuse me');
  const card = panel.getByRole('region', { name: 'Create a group' });
  await expect(card).toBeVisible();
  await expect(
    card.getByText('Nothing is changed. The assistant is told you refused.'),
  ).toBeVisible();
  await card.getByRole('button', { name: 'Refuse' }).click();
  await expect(card.getByText('Refused by you. Nothing was changed.')).toBeVisible();
  await expect(
    panel.getByText('Understood. I did not create the group e2e-refused.'),
  ).toBeVisible();
  expect(groupsNamed('e2e-refused')).toBe(0);
});

test('a system administrator approves a change in another tenant, and it is made there', async ({
  page,
}) => {
  // A tenant no other assistant test creates a group in.
  const target = seeded().other.tenant;
  await signIn(page, accounts.cross);
  await page.goto(`/console/${target}`);
  await page.getByRole('button', { name: 'Ask the assistant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Assistant panel' });
  await expect(panel.getByText(`Acting in ${target}`)).toBeVisible();
  await chooseAct(panel);
  await expect(
    panel.getByText(`Act makes changes in ${target}, not in your own tenant.`, { exact: false }),
  ).toBeVisible();
  await say(page, 'Please approve me');
  const card = panel.getByRole('region', { name: 'Create a group' });
  await expect(card).toBeVisible();
  await expect(card.getByText(`Change in ${target} waiting for your approval`)).toBeVisible();
  await expect(card.getByText(target, { exact: true })).toBeVisible();
  expect(groupsNamed('e2e-approved', target)).toBe(0);
  await expectAccessible(page);

  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card.getByText('Approved by you. The change was made.')).toBeVisible();
  await expect(panel.getByText('The group e2e-approved was created.')).toBeVisible();
  expect(groupsNamed('e2e-approved', target)).toBe(1);
  // The administrator's own tenant is not where it was made.
  expect(groupsNamed('e2e-approved', accounts.cross.tenant)).toBe(0);
});

test('the card fits a phone, with the change stacked and the buttons reachable', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await signIn(page, accounts.phone);
  await page.getByRole('button', { name: 'Ask the assistant' }).first().click();
  const panel = page.getByRole('dialog', { name: 'Assistant panel' });
  await chooseAct(panel);
  await say(page, 'Please refuse me');
  const card = panel.getByRole('region', { name: 'Create a group' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Refuse' })).toBeVisible();
  await expectFitsViewport(page);
  await card.getByRole('button', { name: 'Refuse' }).click();
  await expect(card.getByText('Refused by you. Nothing was changed.')).toBeVisible();
});
