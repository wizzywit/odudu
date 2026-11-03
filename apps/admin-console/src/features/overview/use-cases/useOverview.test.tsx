import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useOverview } from '#/features/overview/use-cases/useOverview';
import { json, pending, problem, type Answer } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const WHOAMI = `GET ${ACME_ADMIN}/whoami`;
const SETTINGS = `GET ${ACME_ADMIN}/settings`;
const SMTP = `GET ${ACME_ADMIN}/smtp`;

const QUIET_SETTINGS = {
  verify_email: false,
  reset_password_allowed: false,
  client_registration_policy: 'disabled',
  max_clients: 200,
};

const NONE = {
  configured: false,
  host: null,
  port: null,
  from_address: null,
  username: null,
  password_set: false,
  starttls: null,
  effective: 'none',
};

function overview(routes: Record<string, Answer>) {
  const harness = hookHarness({
    'GET /console/api/tenants/acme/discovery': json({ issuer: 'https://id.example/tenants/acme' }),
    'GET /console/api/tenants/acme/jwks': json({ keys: [] }),
    ...routes,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return { ...harness, ...renderHook(() => useOverview('acme'), { wrapper }) };
}

const paths = (calls: readonly { path: string }[]) => calls.map((call) => call.path);

it('makes no capability read and shows loading until whoami answers', async () => {
  const { result, calls } = overview({ [WHOAMI]: pending() });
  expect(result.current.attention.status).toBe('checking');
  expect(result.current.tiles.map((tile) => tile.count.status)).toEqual([
    'off',
    'off',
    'off',
    'off',
    'off',
  ]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(
    paths(calls).filter((path) => path.startsWith(ACME_ADMIN) && path !== `${ACME_ADMIN}/whoami`),
  ).toEqual([]);
});

it('leaves out the tiles and the audit rows of what is not held, and names what the checks lacked', async () => {
  const { result, calls } = overview({
    [WHOAMI]: whoami(['manage-tenant']),
    [`GET ${ACME_ADMIN}/groups/count`]: json({ count: 2, capped: false }),
    [`GET ${ACME_ADMIN}/roles/count`]: json({ count: 5, capped: false }),
    [`GET ${ACME_ADMIN}/scopes/count`]: json({ count: 8, capped: false }),
    [SETTINGS]: json(QUIET_SETTINGS),
    [SMTP]: json(NONE),
  });
  await waitFor(() => {
    expect(result.current.attention.status).toBe('ready');
  });
  expect(result.current.tiles.map((tile) => tile.id)).toEqual(['groups', 'roles', 'scopes']);
  expect(result.current.audit).toBeNull();
  expect(result.current.attention.unchecked).toEqual(['manage-keys', 'manage-clients']);
  expect(paths(calls)).not.toContain(`${ACME_ADMIN}/keys`);
  expect(paths(calls)).not.toContain(`${ACME_ADMIN}/subjects/count`);
});

it('shows a held-back read as the capability it needs', async () => {
  const { result } = overview({
    [WHOAMI]: whoami(['view-users']),
    [`GET ${ACME_ADMIN}/subjects/count`]: json({ count: 42, capped: false }),
  });
  await waitFor(() => {
    expect(result.current.tiles.map((tile) => tile.id)).toEqual(['subjects']);
  });
  await waitFor(() => {
    expect(result.current.keys).toMatchObject({
      status: 'ready',
      data: { lanesNeed: 'manage-keys' },
    });
  });
});

it('reads whoami again, once, when the server refuses a read whoami said was allowed', async () => {
  const { calls } = overview({
    [WHOAMI]: whoami(['manage-tenant']),
    [SETTINGS]: problem(403, 'about:blank', 'Forbidden'),
    [SMTP]: json(NONE),
  });
  const whoamis = () => calls.filter((call) => call.path === `${ACME_ADMIN}/whoami`).length;
  await waitFor(() => {
    expect(whoamis()).toBe(2);
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(whoamis()).toBe(2);
});

it('asks again for every read that failed, with one retry', async () => {
  const { result, calls } = overview({
    [WHOAMI]: whoami(['manage-tenant']),
    [SETTINGS]: problem(500, 'about:blank', 'Broken'),
    [SMTP]: problem(500, 'about:blank', 'Broken'),
  });
  await waitFor(() => {
    expect(result.current.attention.failed).toBe(true);
  });
  const before = (path: string) => paths(calls).filter((asked) => asked === path).length;
  const [settings, smtp] = [before(`${ACME_ADMIN}/settings`), before(`${ACME_ADMIN}/smtp`)];
  act(() => {
    result.current.attention.retry();
  });
  await waitFor(() => {
    expect(before(`${ACME_ADMIN}/settings`)).toBe(settings + 1);
    expect(before(`${ACME_ADMIN}/smtp`)).toBe(smtp + 1);
  });
});
