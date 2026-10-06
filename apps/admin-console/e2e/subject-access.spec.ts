import type { Locator, Page } from '@playwright/test';
import {
  expect,
  expectAccessible,
  expectFitsViewport,
  forgive,
  signIn,
  signInAtTenant,
  test,
  type Problem,
} from './fixtures.ts';
import { psql, seed, seeded } from './stack.ts';

const { subjects, system } = seeded();
const { admin, viewer } = subjects;
const TENANT = admin.tenant;
const PHONE = { width: 390, height: 844 };

type Tab =
  'profile' | 'credentials' | 'groups' | 'roles' | 'required-actions' | 'sessions' | 'consents';

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function subjectId(username: string): string {
  return psql(
    `select u.subject_id from users u join tenants t on t.id = u.tenant_id where t.name = ${sqlText(TENANT)} and u.username = ${sqlText(username)}`,
  );
}

function heldRoles(username: string): string {
  return psql(
    `select coalesce(string_agg(r.name, ',' order by r.name), '') from subject_roles sr join roles r on r.id = sr.role_id where sr.subject_id = '${subjectId(username)}'`,
  );
}

// Moves focus with Tab alone until it lands on `target`.
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let pressed = 0; pressed < 40; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function openSubject(page: Page, username: string, tab: Tab): Promise<void> {
  await page.goto(`/console/${TENANT}/subjects/${subjectId(username)}?tab=${tab}`);
  await expect(page.getByRole('heading', { level: 1, name: username })).toBeVisible();
}

// A session ended under the page answers its next reads 401, which the
// browser logs; those, and nothing else, are expected here.
function forgiveEnded(problems: Problem[]): void {
  const kept = problems.filter((problem) => !problem.text.includes('status of 401'));
  problems.splice(0, problems.length, ...kept);
}

test("a subject's groups and roles change, and what it holds follows", async ({ page }) => {
  await signIn(page, admin);
  await openSubject(page, subjects.member, 'groups');
  const groups = page.getByRole('region', { name: 'Groups' });
  await expect(groups.getByText(`${subjects.member} belongs to no group.`)).toBeVisible();
  await expectAccessible(page);
  await groups
    .getByRole('listbox', { name: `Groups ${subjects.member} belongs to` })
    .getByRole('option', { name: /finance/u })
    .click();
  await groups.getByRole('button', { name: 'Save Groups' }).click();
  await expect(groups.getByRole('button', { name: 'Save Groups' })).toBeHidden();
  await expect(groups.getByRole('list', { name: `${subjects.member} belongs to` })).toHaveText(
    '/finance',
  );

  await page.getByRole('tab', { name: 'Roles' }).click();
  const held = page.getByRole('grid', { name: `Every role ${subjects.member} holds` });
  await expect(held.getByRole('row', { name: /billing-reader/u })).toContainText(
    'through group /finance',
  );
  const roles = page.getByRole('region', { name: 'Roles' });
  await roles
    .getByRole('listbox', { name: `Roles ${subjects.member} holds directly` })
    .getByRole('option', { name: /auditor/u })
    .click();
  await roles.getByRole('button', { name: 'Save Roles' }).click();
  await expect(roles.getByRole('button', { name: 'Save Roles' })).toBeHidden();
  await expect(held.getByRole('row', { name: /auditor/u })).toContainText('directly');
  await expect.poll(() => heldRoles(subjects.member)).toBe('auditor');
  await expectAccessible(page);
});

test('a tenant administrator gives an admin capability by checkbox, within their own', async ({
  page,
}) => {
  await signIn(page, admin);
  await openSubject(page, subjects.holder, 'roles');
  const section = page.getByRole('region', { name: 'Admin capabilities' });
  await section.getByText('view-audit', { exact: true }).click();
  await expect(section.getByRole('checkbox', { name: 'view-audit' })).toBeChecked();
  await expectAccessible(page);
  await section.getByRole('button', { name: 'Save Admin capabilities' }).click();
  await expect(section.getByRole('checkbox', { name: 'view-audit' })).toBeChecked();
  await expect(
    page.getByRole('grid', { name: `Every role ${subjects.holder} holds` }),
  ).toContainText('view-audit');
  expect(heldRoles(subjects.holder)).toBe('view-audit');
});

test("a system administrator changes a holder's capabilities from the tenant's record, by keyboard", async ({
  page,
}) => {
  await page.goto('/console/system');
  await signInAtTenant(page, system);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await page.goto(`/console/system/tenants/${TENANT}?tab=administrators`);
  const holders = page.getByRole('list', { name: `Administrators of ${TENANT}` });
  await expect(holders.getByRole('list', { name: `What ${subjects.listed} holds` })).toHaveText(
    'view-audit · directly',
  );
  await expectAccessible(page);

  await page.getByRole('searchbox', { name: 'Search by Username' }).focus();
  await page.keyboard.type(subjects.listed);
  await page.keyboard.press('Enter');
  await expect(holders.getByRole('link')).toHaveText([subjects.listed]);
  await tabTo(
    page,
    holders.getByRole('button', { name: `Change ${subjects.listed}’s capabilities` }),
  );
  await page.keyboard.press('Enter');
  const section = holders.getByRole('region', { name: 'Admin capabilities' });
  await tabTo(page, section.getByRole('checkbox', { name: 'manage-sessions' }));
  await page.keyboard.press('Space');
  await expectAccessible(page);
  await tabTo(page, section.getByRole('button', { name: 'Save Admin capabilities' }));
  await page.keyboard.press('Enter');
  await expect(holders.getByRole('list', { name: `What ${subjects.listed} holds` })).toContainText(
    'manage-sessions',
  );
  expect(heldRoles(subjects.listed)).toBe('manage-sessions,view-audit');
});

test('a required action is asked of the subject at its next sign-in', async ({ page, browser }) => {
  await signIn(page, admin);
  await openSubject(page, subjects.asked.username, 'required-actions');
  const section = page.getByRole('region', { name: 'Required actions' });
  await section.getByText('Choose a new password', { exact: true }).click();
  await section.getByRole('button', { name: 'Save Required actions' }).click();
  await expect(section.getByText('Choose a new password')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Save Required actions' })).toBeHidden();
  await expectAccessible(page);

  const other = await browser.newPage();
  await other.goto(`/console/${TENANT}`);
  await signInAtTenant(other, subjects.asked);
  await expect(
    other.getByRole('heading', { level: 1, name: 'Change your password' }),
  ).toBeVisible();
  await other.close();
});

test('a subject with more consents than a page holds has them paged, and Load more adds the rest', async ({
  page,
}) => {
  const member = subjects.member;
  const id = subjectId(member);
  psql(`
    with made as (
      insert into clients (id, tenant_id, client_id, name, type)
      select gen_random_uuid(), t.id, 'paged-' || g, 'Paged ' || g, 'public'
        from tenants t, generate_series(1, 60) g where t.name = ${sqlText(TENANT)}
      returning id, tenant_id),
    configured as (
      insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method)
      select id, tenant_id, '{https://paged.example/cb}', '{authorization_code}', 'none' from made)
    insert into consents (id, tenant_id, subject_id, client_id)
    select gen_random_uuid(), tenant_id, '${id}', id from made`);
  await signIn(page, admin);
  await openSubject(page, member, 'consents');
  const table = page.getByRole('grid', { name: `Consents ${member} has given` });
  await expect(table.getByRole('row')).toHaveCount(51);
  await page.getByRole('button', { name: `Load more consents ${member} has given` }).click();
  await expect(table.getByRole('row')).toHaveCount(61);
  await expectAccessible(page);
});

test('an administrator ends their own sessions, is told so first, and is signed out', async ({
  page,
  problems,
}) => {
  const { ender } = subjects;
  await signIn(page, ender);
  await openSubject(page, ender.username, 'sessions');
  const sessions = page.getByRole('grid', { name: `Live sessions of ${ender.username}` });
  await expect(sessions.getByRole('row')).not.toHaveCount(1);
  await page.getByRole('tab', { name: 'Grants' }).click();
  await expect(page.getByRole('grid', { name: `Grants ${ender.username} holds` })).toContainText(
    'odudu-admin',
  );
  await page.getByRole('tab', { name: 'Consents' }).click();
  await expect(
    page.getByText(`${ender.username} has given no consent to any client.`),
  ).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Sessions' }).click();
  await page.getByRole('button', { name: 'End every session' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'End every session of your own?' });
  await expect(dialog).toContainText('The one this console signed you in through is among them');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'End every session' }).click();
  // The ending is noticed by whichever request comes next, and the list's own
  // refetch may get there first, so the test only waits for sign-in to show.
  await expect(page.getByLabel('Username')).toBeVisible({ timeout: 15_000 });
  forgiveEnded(problems);
});

test('a mail the tenant cannot send is explained in place, with where to put it right', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await openSubject(page, subjects.member, 'credentials');
  const mail = page.getByRole('region', { name: 'Email' });
  await expect(mail).toContainText(`${subjects.member}@`);
  await mail.getByRole('button', { name: 'Send a verification email' }).click();
  await expect(mail.getByText(/the mail would only be logged/u)).toBeVisible();
  await expect(mail.getByRole('link', { name: 'Email' })).toHaveAttribute(
    'href',
    `/console/${TENANT}/email`,
  );
  forgive(problems, `/subjects/${subjectId(subjects.member)}/verification`);
  await expectAccessible(page);
});

test('a limited operator sees what a subject holds, and can change none of it', async ({
  page,
}) => {
  await signIn(page, viewer);
  await openSubject(page, subjects.listed, 'roles');
  // Both reasons this record cannot be changed are said, each once.
  await expect(
    page.getByText('You can view subjects but not change them', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(`${subjects.listed} holds`, { exact: false }).first()).toBeVisible();
  const capabilities = page.getByRole('region', { name: 'Admin capabilities' });
  await expect(capabilities).toContainText('view-audit');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('tab', { name: 'Groups' }).click();
  await expect(page.getByText(`${subjects.listed} belongs to no group.`)).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Sessions' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'Sessions needs the' })).toHaveText(
    'Sessions needs the manage-sessions capability.',
  );
  await expectAccessible(page);
});

test('a membership changed behind an open page is shown beside yours, and nothing merges', async ({
  page,
  problems,
}) => {
  await signIn(page, admin);
  await openSubject(page, subjects.raced, 'groups');
  const groups = page.getByRole('region', { name: 'Groups' });
  const options = groups.getByRole('listbox', { name: `Groups ${subjects.raced} belongs to` });
  await options.getByRole('option', { name: /finance/u }).click();
  seed(['join-group', '--tenant', TENANT, '--username', subjects.raced, '--group', '/ops']);
  await groups.getByRole('button', { name: 'Save Groups' }).click();
  await expect(groups.getByText(/changed elsewhere/u).first()).toBeVisible();
  await expectAccessible(page);
  forgive(problems, `/subjects/${subjectId(subjects.raced)}/groups`);
  expect(
    psql(`select count(*) from subject_groups where subject_id = '${subjectId(subjects.raced)}'`),
  ).toBe('1');
});

// One test a tab, each with its own budget: a page is about a second of
// loading and four axe passes, and all four in one test left the thirty
// seconds a margin that the full run's parallel workers took away.
for (const tab of ['groups', 'roles', 'required-actions', 'sessions'] as const) {
  test(`a subject's ${tab} tab fits a phone`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, admin);
    await openSubject(page, subjects.member, tab);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expectFitsViewport(page, tab);
    await expectAccessible(page);
  });
}

test('a Profile edit made as the session ends is restored after signing in again, and guarded', async ({
  page,
  problems,
}) => {
  const { resumer, drafted } = subjects;
  await signIn(page, resumer);
  await openSubject(page, drafted, 'profile');
  const name = page.getByRole('textbox', { name: 'Full name' });
  await name.fill('Sophie Germain');
  psql(
    `delete from console_sessions where subject_id in (select u.subject_id from users u ` +
      `join tenants t on t.id = u.tenant_id where t.name = ${sqlText(TENANT)} ` +
      `and u.username = ${sqlText(resumer.username)})`,
  );
  const back = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/console/api/session' && response.status() === 200,
  );
  // The way back runs through the tenant's own sign-in, not around it.
  const authorize = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith(`/tenants/${TENANT}/protocol/openid-connect/auth`),
  );
  await page.getByRole('button', { name: 'Save Name' }).click();
  await authorize;
  await back;
  forgiveEnded(problems);

  await expect(page).toHaveURL(
    new RegExp(`/console/${TENANT}/subjects/${subjectId(drafted)}`, 'u'),
  );
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Sophie Germain');
  await expect(page.getByText('Restored — review before saving')).toBeVisible();
  expect(
    psql(
      `select coalesce(u.name, '<null>') from users u join tenants t on t.id = u.tenant_id where t.name = ${sqlText(TENANT)} and u.username = ${sqlText(drafted)}`,
    ),
  ).toBe('<null>');
  await expectAccessible(page);

  // A reload while the section is dirty asks first.
  await page.getByRole('textbox', { name: 'Full name' }).fill('Sophie Germain!');
  const asked = page.waitForEvent('dialog');
  const reloading = page.reload();
  const dialog = await asked;
  expect(dialog.type()).toBe('beforeunload');
  // Staying cancels the reload, which therefore never settles.
  reloading.catch(() => undefined);
  await dialog.dismiss();
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Sophie Germain!');
  await expect(page.getByText('Restored — review before saving')).toBeVisible();
});
