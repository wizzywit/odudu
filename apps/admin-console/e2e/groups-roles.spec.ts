import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, forgive, signIn, test } from './fixtures.ts';
import { psql, seeded } from './stack.ts';

const { groupsRoles } = seeded();
const { admin, limited, member } = groupsRoles;
const TENANT = admin.tenant;
const UNBROKEN = 'segment'.repeat(8);
const UNBROKEN_PATH = `/${UNBROKEN}/${UNBROKEN}`;
const PHONE = { width: 390, height: 844 };

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const IN_TENANT = `(select id from tenants where name = ${sqlText(TENANT)})`;

function groupId(path: string): string {
  return psql(`select id from groups where tenant_id = ${IN_TENANT} and path = ${sqlText(path)}`);
}

function groupField(path: string, column: string): string {
  return psql(
    `select coalesce(${column}::text, '<null>') from groups where tenant_id = ${IN_TENANT} and path = ${sqlText(path)}`,
  );
}

// A tenant role, or the built-in admin client's role of that name.
function roleId(name: string, builtin = false): string {
  const owner = builtin
    ? `client_id = (select id from clients where tenant_id = ${IN_TENANT} and client_id = 'odudu-admin')`
    : 'client_id is null';
  return psql(
    `select id from roles where tenant_id = ${IN_TENANT} and name = ${sqlText(name)} and ${owner}`,
  );
}

function groupRoles(path: string): string {
  return psql(
    `select coalesce(string_agg(r.name, ',' order by r.name), '') from group_roles gr join roles r on r.id = gr.role_id where gr.group_id = '${groupId(path)}'`,
  );
}

function nested(name: string): string {
  return psql(
    `select coalesce(string_agg(r.name, ',' order by r.name), '') from role_composites rc join roles r on r.id = rc.child_role_id where rc.parent_role_id = '${roleId(name)}'`,
  );
}

// Moves focus with Tab alone until it lands on `target`.
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let pressed = 0; pressed < 80; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function openGroup(page: Page, path: string, tab = 'general'): Promise<void> {
  await page.goto(`/console/${TENANT}/groups/${groupId(path)}?tab=${tab}`);
  await expect(page.getByRole('heading', { level: 1, name: path })).toBeVisible();
}

async function openRole(page: Page, id: string, name: string, tab = 'general'): Promise<void> {
  await page.goto(`/console/${TENANT}/roles/${id}?tab=${tab}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('a group is made under another, given a role, moved and made a default', async ({ page }) => {
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/groups`);
  const tree = page.getByRole('list', { name: 'Groups' });
  await expect(tree.getByRole('link', { name: 'eng', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'Show the groups under /eng' }).click();
  await expect(
    tree
      .getByRole('list', { name: 'Under /eng' })
      .getByRole('link', { name: 'platform', exact: true }),
  ).toBeVisible();
  await expectAccessible(page);

  await tree.getByRole('link', { name: 'eng', exact: true }).click();
  await page.getByRole('link', { name: 'Create a group under /eng', exact: true }).click();
  await expect(page.getByText('It will sit under /eng.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Name' }).fill('qa');
  await page.getByRole('textbox', { name: 'Description' }).fill('Tests it');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '/eng/qa' })).toBeVisible();

  await page.getByRole('tab', { name: 'Roles' }).click();
  const roles = page.getByRole('region', { name: 'Roles' });
  await roles
    .getByRole('listbox', { name: 'Roles /eng/qa carries' })
    .getByRole('option', { name: 'auditor, a tenant role' })
    .click();
  await roles.getByRole('button', { name: 'Save Roles' }).click();
  await expect(roles.getByRole('list', { name: 'Carried by /eng/qa' })).toContainText('auditor');
  await expect.poll(() => groupRoles('/eng/qa')).toBe('auditor');
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'General' }).click();
  const place = page.getByRole('region', { name: 'Place in the tree' });
  await place
    .getByRole('listbox', { name: 'Parent' })
    .getByRole('option', { name: 'finance', exact: true })
    .click();
  await place.getByRole('button', { name: 'Save Place in the tree' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '/finance/qa' })).toBeVisible();

  const fresh = page.getByRole('region', { name: 'New subjects' });
  await fresh.getByText('Joined by every new subject', { exact: true }).click();
  await fresh.getByRole('button', { name: 'Save New subjects' }).click();
  await expect(fresh.getByRole('button', { name: 'Save New subjects' })).toBeHidden();
  await expect.poll(() => groupField('/finance/qa', 'default_for_new_subjects')).toBe('true');
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Activity' }).click();
  const trail = page.getByRole('grid', { name: 'Activity on this group' });
  await expect(trail).toContainText('group.default_set');
  await expect(trail).toContainText('group.roles_set');
  await expectAccessible(page);
});

test("a group's members are listed, and a subtree is deleted once its path is typed", async ({
  page,
}) => {
  await signIn(page, admin);
  await openGroup(page, '/eng', 'members');
  await expect(page.getByRole('grid', { name: 'Members of /eng' })).toContainText(member);
  await expectAccessible(page);

  await openGroup(page, '/doomed');
  await page.getByRole('button', { name: 'Delete /doomed and every group beneath it' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete /doomed?' });
  await expect(dialog).toContainText('deletes every group beneath it too');
  await expectAccessible(page);
  await dialog.getByRole('textbox').fill('/doomed');
  await dialog.getByRole('button', { name: 'Delete /doomed' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  expect(
    psql(`select count(*) from groups where tenant_id = ${IN_TENANT} and path like '/doomed%'`),
  ).toBe('0');
});

test('a description changed behind an open page is shown beside yours, and nothing merges', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await openGroup(page, '/raced');
  const section = page.getByRole('region', { name: 'Description' });
  await section.getByRole('textbox', { name: 'Description' }).fill('Mine');
  psql(
    `update groups set description = 'Theirs' where tenant_id = ${IN_TENANT} and path = '/raced'`,
  );
  await section.getByRole('button', { name: 'Save Description' }).click();
  await expect(section.getByText(/changed elsewhere/u).first()).toBeVisible();
  await expect(section.getByRole('button', { name: 'Keep mine in Description' })).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/groups/${groupId('/raced')}`);
  await expect.poll(() => groupField('/raced', 'description')).toBe('Theirs');
});

test('a parent handing out what the caller lacks is never offered, and says why', async ({
  page,
}) => {
  await signIn(page, limited);
  await openGroup(page, '/movable');
  const place = page.getByRole('region', { name: 'Place in the tree' });
  const admins = place
    .getByRole('listbox', { name: 'Parent' })
    .getByRole('option', { name: 'admins', exact: true });
  await expect(admins).toContainText('its members receive view-users, which you do not hold');
  // Heard but not chosen: an option that cannot be chosen is never enabled.
  await expect(admins).toHaveAttribute('aria-disabled', 'true');
  await expect(place.getByRole('button', { name: 'Save Place in the tree' })).toHaveCount(0);
  await expectAccessible(page);
  await expect.poll(() => groupField('/movable', 'parent_id')).toBe('<null>');
});

test('a move onto a name the new parent already holds is refused, and said why', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await openGroup(page, '/dup');
  const place = page.getByRole('region', { name: 'Place in the tree' });
  await place
    .getByRole('listbox', { name: 'Parent' })
    .getByRole('option', { name: 'finance', exact: true })
    .click();
  await place.getByRole('button', { name: 'Save Place in the tree' }).click();
  await expect(
    place.getByText(
      'Refused: the parent chosen already holds a group named "dup", and two groups beside each other cannot share a name. Nothing was changed.',
    ),
  ).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/groups/${groupId('/dup')}`);
  await expect.poll(() => groupField('/dup', 'parent_id')).toBe('<null>');
});

test('a limited operator is offered only what it could do, each refusal said once', async ({
  page,
}) => {
  await signIn(page, limited);
  await openGroup(page, '/admins');
  await expect(
    page.getByText(
      'Its members hold view-users through it, which you do not hold, so you cannot delete it.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete/u })).toHaveCount(0);
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Roles' }).click();
  const options = page.getByRole('listbox', { name: 'Roles /admins carries' });
  await expect(
    options.getByRole('option', { name: 'view-users, a role of client odudu-admin' }),
  ).toContainText('You do not hold view-users, so you cannot give or take it.');
  await expect(page.getByText(/cannot take away either/u)).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Members' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'Members needs the' })).toHaveText(
    'Members needs the view-users capability.',
  );
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'Activity needs the' })).toHaveText(
    'Activity needs the view-audit capability.',
  );
  await expectAccessible(page);
});

test('a role is made, given and relieved of a composite, and copied under a new name', async ({
  page,
}) => {
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/roles`);
  const table = page.getByRole('grid', { name: 'Roles' });
  const readers = table.getByRole('row', { name: /reader/u });
  await expect(readers.filter({ hasText: 'tenant role' })).toHaveCount(1);
  await expect(readers.filter({ hasText: 'role of client portal' })).toHaveCount(1);
  await expect(table.getByRole('row', { name: /tenant-admin/u })).toContainText('admin capability');
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Create a role' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('billing');
  await page.getByRole('textbox', { name: 'Description' }).fill('Bills');
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'billing' })).toBeVisible();

  await page.getByRole('tab', { name: 'Composites' }).click();
  const add = page.getByRole('region', { name: 'Add a composite' });
  const nest = async () => {
    await add
      .getByRole('listbox', { name: 'Role to nest in billing' })
      .getByRole('option', { name: 'auditor, a tenant role' })
      .click();
    await add.getByRole('button', { name: 'Nest it in billing' }).click();
    await expect(page.getByRole('list', { name: 'Nested in billing' })).toContainText('auditor');
  };
  await nest();
  await expect.poll(() => nested('billing')).toBe('auditor');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Take auditor out' }).click();
  await expect(page.getByText('billing nests no role.')).toBeVisible();
  await expect.poll(() => nested('billing')).toBe('');
  await nest();

  await page.getByRole('link', { name: 'Create a copy' }).click();
  await expect(page.getByText('A copy of billing, nesting auditor.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue('Bills');
  await expectAccessible(page);
  await page.getByRole('textbox', { name: 'Name' }).fill('billing-copy');
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'billing-copy' })).toBeVisible();
  await expect.poll(() => nested('billing-copy')).toBe('auditor');
});

test('a default is refused for a role reaching a capability, with the reason', async ({ page }) => {
  await signIn(page, admin);
  await openRole(page, roleId('helper'), 'helper');
  const helper = page.getByRole('region', { name: 'New subjects' });
  await expect(
    helper.getByText(/It reaches view-users, and a role every new subject/u),
  ).toBeVisible();
  await expect(helper.getByRole('switch')).toHaveCount(0);
  await expectAccessible(page);

  // Its capability is nested two deep, and the server's reach says so.
  await openRole(page, roleId('deep'), 'deep');
  const deep = page.getByRole('region', { name: 'New subjects' });
  await expect(
    deep.getByText(/It reaches view-users, and a role every new subject/u),
  ).toBeVisible();
  await expect(deep.getByRole('switch')).toHaveCount(0);

  await openRole(page, roleId('manage-users', true), 'manage-users');
  await expect(
    page.getByText(
      'A capability of the built-in admin client is never handed to every new subject.',
    ),
  ).toBeVisible();
  await expect(page.getByText(/so it cannot be deleted/u)).toBeVisible();
  await page.getByRole('tab', { name: 'Composites' }).click();
  await expect(page.getByText(/keeps the roles it was provisioned with/u)).toBeVisible();
  await expectAccessible(page);
});

test("a group's description is changed by keyboard alone, from the tree", async ({ page }) => {
  await signIn(page, admin);
  await page.goto(`/console/${TENANT}/groups`);
  const tree = page.getByRole('list', { name: 'Groups' });
  await tabTo(page, tree.getByRole('link', { name: 'keyed', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: '/keyed' })).toBeVisible();
  const field = page.getByRole('textbox', { name: 'Description' });
  await tabTo(page, field);
  await page.keyboard.type('Typed by keyboard');
  const save = page.getByRole('button', { name: 'Save Description' });
  await tabTo(page, save);
  await page.keyboard.press('Enter');
  await expect(save).toBeHidden();
  await expect.poll(() => groupField('/keyed', 'description')).toBe('Typed by keyboard');
  await expectAccessible(page);
});

test('the groups and roles pages fit a phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, admin);
  const pages = [
    `/console/${TENANT}/groups`,
    `/console/${TENANT}/groups/${groupId('/eng')}`,
    `/console/${TENANT}/groups/${groupId('/eng')}?tab=roles`,
    `/console/${TENANT}/groups/${groupId(UNBROKEN_PATH)}`,
    `/console/${TENANT}/groups/${groupId(UNBROKEN_PATH)}?tab=roles`,
    `/console/${TENANT}/roles`,
    `/console/${TENANT}/roles/${roleId('auditor')}`,
    `/console/${TENANT}/roles/${roleId('auditor')}?tab=composites`,
  ];
  for (const address of pages) {
    await page.goto(address);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.locator('[role="status"]', { hasText: /^Loading/u })).toHaveCount(0);
    await expect(page.getByText(/^Checking /u)).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, address).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  }
});
