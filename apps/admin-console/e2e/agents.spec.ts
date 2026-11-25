import { expect, expectAccessible, expectFitsViewport, signIn, test, PHONE } from './fixtures';
import { inTenant, psql, seeded, sqlText } from './stack';

const { admin, tenantOnly } = seeded().access.tokens;
const { admin: lister } = seeded().sessions.list;
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

// Fixed ids, so a retry or a rerun finds the same two runs and starts them over
// instead of adding a pair. The end of an id names a run in the list.
const GRANT = '00000000-0000-4000-8000-0000e2e0a000';
const ROOT = '00000000-0000-4000-8000-0000e2e0a001';
const CHILD = '00000000-0000-4000-8000-0000e2e0a002';
const ROOT_TAIL = ROOT.slice(-8);

// A live run and one it started, for the tenant's first administrator, under an
// ordinary client of the tenant: runs are made by an agent calling the server,
// which this stack has no agent for.
function seedLineage(tenant: string, owner: string): string {
  const t = inTenant(tenant);
  const client = `(select id from clients where tenant_id = ${t} order by id limit 1)`;
  psql(
    `with owner as (select u.subject_id id from users u where u.tenant_id = ${t} and u.username = ${sqlText(owner)}),
      g as (insert into token_grants (id, tenant_id, client_id, subject_id, scope)
            select '${GRANT}'::uuid, ${t}, ${client}, owner.id, 'openid' from owner
            on conflict (id) do nothing returning 1),
      s as (insert into subjects (id, tenant_id, type)
            select unnest(array['${ROOT}'::uuid, '${CHILD}'::uuid]), ${t}, 'agent_instance'
            on conflict (id) do nothing returning 1),
      i as (insert into agent_instances
              (id, tenant_id, owner_subject_id, agent_client_id, parent_instance_id, root_grant_id, depth, scope, expires_at)
            select '${ROOT}'::uuid, ${t}, owner.id, ${client}, null::uuid, '${GRANT}'::uuid, 1, 'openid', now() + interval '1 hour' from owner
            union all
            select '${CHILD}'::uuid, ${t}, owner.id, ${client}, '${ROOT}'::uuid, '${GRANT}'::uuid, 2, 'openid', now() + interval '1 hour' from owner
            on conflict (id) do nothing returning 1)
     update agent_instances set revoked_at = null, expires_at = now() + interval '1 hour'
      where id in ('${ROOT}'::uuid, '${CHILD}'::uuid)`,
  );
  return psql(`select c.client_id from clients c where c.id = ${client}`);
}

function revokedRuns(): number {
  return Number(
    psql(
      `select count(*) from agent_instances where id in ('${ROOT}'::uuid, '${CHILD}'::uuid) and revoked_at is not null`,
    ),
  );
}

test('a lineage is drawn from its top, and revoking the top says what it ends before it ends it', async ({
  page,
}) => {
  const client = seedLineage(lister.tenant, lister.username);
  await signIn(page, lister);
  await page.goto(`/console/${lister.tenant}/agents`);
  await expect(page.getByRole('list', { name: 'Agents' })).toBeVisible();
  const top = page.getByRole('listitem', { name: new RegExp(`\\(${ROOT_TAIL}\\)$`, 'u') });
  await expect(top).toContainText(client);
  await expect(top.getByRole('list')).toHaveCount(1);
  await expectAccessible(page);

  await top
    .getByRole('button', { name: /^Revoke / })
    .first()
    .click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(/ends 2 instances, this one and every run/u);
  expect(revokedRuns()).toBe(0);
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Revoke run' }).click();
  await expect(page.getByRole('status', { name: 'Last revoke' })).toContainText(
    /ended: 2 instances/u,
  );
  expect(revokedRuns()).toBe(2);
});
