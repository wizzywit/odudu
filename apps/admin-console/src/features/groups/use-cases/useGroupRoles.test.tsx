import type { GroupRecord } from '#/entities/group';
import type { GroupRole } from '#/features/groups/types/groupRoles';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useGroupRoles } from '#/features/groups/use-cases/useGroupRoles';
import { type GroupCeiling } from '#/features/groups/services/groupCeiling';
import { json, type Answer } from '#/testing/fakeTransport';
import { record } from '#/testing/groupAnswers';
import { ENG, G } from '#/testing/groupsFixtures';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { role } from '#/testing/roleAnswers';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const PUT = `PUT ${G}/g-eng/roles`;

const KEYS = role('r-keys', 'manage-keys', 'odudu-admin');
const USERS = role('r-users', 'view-users', 'odudu-admin');
const PLAIN = role('r-aud', 'auditor');

function ceilingOf(caller: Extract<GroupCeiling, { status: 'ready' }>['caller']): GroupCeiling {
  return {
    status: 'ready',
    parentReach: [],
    caller,
    lines: { move: null, remove: null },
  };
}

function roles(
  items: GroupRole[],
  caller: Extract<GroupCeiling, { status: 'ready' }>['caller'],
  extra: Record<string, Answer> = {},
) {
  const harness = hookHarness({
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['manage-tenant']),
    [`GET ${ACME_ADMIN}/roles`]: json({ items: [] }),
    [PUT]: json({ items: [] }, 200, { etag: '"r2"' }),
    ...extra,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(
    () =>
      useGroupRoles({
        tenant: 'acme',
        group: record(ENG) as GroupRecord,
        data: { items },
        etag: '"r1"',
        gone: false,
        ceiling: ceilingOf(caller),
      }),
    { wrapper },
  );
  return { ...view, sent: harness.sent };
}

it('keeps a role the caller could not give when the choice is replaced, and saves it', async () => {
  const { result, sent } = roles([KEYS], ['view-users']);
  expect(result.current.kept).toEqual(['r-keys']);
  act(() => {
    result.current.choose([]);
  });
  expect(result.current.save.values.role_ids).toEqual(['r-keys']);
  act(() => {
    result.current.choose(['r-aud']);
  });
  expect(result.current.save.values.role_ids).toEqual(['r-aud', 'r-keys']);
  await waitFor(() => {
    expect(result.current.save.blocked).toBeUndefined();
  });
  act(() => {
    result.current.save.submit();
  });
  await waitFor(() => {
    expect(sent.some((request) => request.method === 'PUT')).toBe(true);
  });
  expect(sent.find((request) => request.method === 'PUT')?.body).toEqual({
    role_ids: ['r-aud', 'r-keys'],
  });
});

it('asks first when the roles taken off reach what the caller holds', async () => {
  const { result, sent } = roles([USERS, PLAIN], ['view-users']);
  await waitFor(() => {
    expect(result.current.save.blocked).toBeUndefined();
  });
  act(() => {
    result.current.choose(['r-aud']);
  });
  act(() => {
    result.current.save.submit();
  });
  expect(result.current.asking?.title).toBe('Take roles your own access runs through?');
  expect(result.current.asking?.consequence).toContain('If you hold view-users through /eng');
  expect(sent.some((request) => request.method === 'PUT')).toBe(false);
});

it('saves at once when the roles taken off reach nothing the caller holds', async () => {
  const { result, sent } = roles([USERS, PLAIN], []);
  await waitFor(() => {
    expect(result.current.save.blocked).toBeUndefined();
  });
  act(() => {
    result.current.choose(['r-users']);
  });
  act(() => {
    result.current.save.submit();
  });
  expect(result.current.asking).toBeNull();
  await waitFor(() => {
    expect(sent.some((request) => request.method === 'PUT')).toBe(true);
  });
});
