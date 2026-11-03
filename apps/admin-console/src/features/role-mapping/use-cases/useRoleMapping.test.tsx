import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { ReachFrom, RoleValues } from '#/entities/role';
import { SignedInContext } from '#/entities/session';
import { useRoleMapping } from '#/features/role-mapping/use-cases/useRoleMapping';
import type { SaveInput } from '#/shared/lib/repository/useSectionSave';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { role } from '#/testing/roleAnswers';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

const KEYS = role('r-keys', 'manage-keys', 'odudu-admin');
const PLAIN = role('r-aud', 'auditor');
const HIDING = { ...PLAIN, admin_reach: [] };

function mapping({
  items,
  offered = true,
  reachFrom,
  picked = [],
}: {
  items: (typeof KEYS)[];
  offered?: boolean;
  reachFrom: ReachFrom;
  picked?: (typeof KEYS)[];
}) {
  const harness = hookHarness({ [`GET ${ACME_ADMIN}/roles`]: json({ items: picked }) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const saveRoles = vi.fn((_gateway: unknown, input: SaveInput<RoleValues>) =>
    Promise.resolve({
      ok: true as const,
      status: 200,
      data: input.values,
      etag: '"r2"',
      next: null,
    }),
  );
  const view = renderHook(
    () =>
      useRoleMapping({
        tenant: 'acme',
        record: 'scopes/s1/roles',
        etag: '"r1"',
        gone: false,
        items,
        caller: ['manage-tenant'],
        offered,
        unavailableOf: () => null,
        reachFrom,
        saveRoles,
      }),
    { wrapper },
  );
  return { ...view, saveRoles };
}

it('keeps a mapped role the caller could not give, whatever else is chosen', async () => {
  const { result, saveRoles } = mapping({ items: [KEYS], reachFrom: 'entry' });
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
    expect(saveRoles).toHaveBeenCalledOnce();
  });
  expect(saveRoles.mock.calls[0]?.[1]).toMatchObject({
    ifMatch: '"r1"',
    values: { role_ids: ['r-aud', 'r-keys'] },
  });
});

it('keeps nothing when every mapped role is one the caller could give', () => {
  const { result } = mapping({ items: [PLAIN], reachFrom: 'entry' });
  expect(result.current.kept).toEqual([]);
  act(() => {
    result.current.choose([]);
  });
  expect(result.current.save.values.role_ids).toEqual([]);
});

it('judges a role by the reach its own entry carries unless told to read the picker', async () => {
  const { result } = mapping({
    items: [HIDING],
    reachFrom: 'entry',
    picked: [{ ...PLAIN, admin_reach: ['manage-keys'] }],
  });
  await waitFor(() => {
    expect(result.current.picker.options).toHaveLength(1);
  });
  expect(result.current.kept).toEqual([]);
});

it("judges a role by the picker's reach when told to, which may override the entry's", async () => {
  const { result } = mapping({
    items: [HIDING],
    reachFrom: 'picker',
    picked: [{ ...PLAIN, admin_reach: ['manage-keys'] }],
  });
  await waitFor(() => {
    expect(result.current.kept).toEqual(['r-aud']);
  });
});

it('says whether the picker is offered as it was told', () => {
  expect(mapping({ items: [], offered: false, reachFrom: 'entry' }).result.current.offered).toBe(
    false,
  );
  expect(mapping({ items: [], offered: true, reachFrom: 'entry' }).result.current.offered).toBe(
    true,
  );
});
