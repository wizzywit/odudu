import type { Role } from '@odudu/contracts/admin';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { roleCeiling } from '#/features/roles/services/roleCeiling';
import { useRoleGeneral } from '#/features/roles/use-cases/useRoleGeneral';
import { useToasts } from '#/shared/repository/useToasts';
import type { AdminCapability } from '#/shared/services/principal';
import { whoamiReads, type Answer } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { role } from '#/testing/roleAnswers';
import { R } from '#/testing/rolesFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

vi.mock('#/shared/repository/useGo', () => ({ useGo: () => vi.fn() }));

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const REACHING = role('r-aud', 'auditor', null, ['view-users', 'manage-users']);
const PLAIN = role('r-plain', 'plain');
const BUILTIN = role('r-keys', 'manage-keys', 'odudu-admin');

afterEach(() => {
  useToasts.setState({ toasts: [], nextId: 1 });
});

function general(target: Role, caller: AdminCapability[], extra: Record<string, Answer> = {}) {
  const harness = hookHarness({
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['manage-tenant']),
    [`DELETE ${R}/${target.id}`]: () => new Response(null, { status: 204 }),
    ...extra,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(
    () =>
      useRoleGeneral({
        tenant: 'acme',
        role: target,
        etag: '"r1"',
        gone: false,
        ceiling: roleCeiling(target, { capabilities: caller, crossTenant: false }),
      }),
    { wrapper },
  );
  return { ...view, sent: harness.sent };
}

it('refuses to make a role reaching a capability a default, in its own sentence', () => {
  const { result } = general(REACHING, ['view-users']);
  expect(result.current.defaults.fixed).toBe(
    'It reaches view-users and manage-users, and a role every new subject receives may reach no admin capability. Take those composites out of it first.',
  );
});

it('lets a role that reaches nothing be a default, and leaves a built-in one fixed', () => {
  expect(general(PLAIN, []).result.current.defaults.fixed).toBeNull();
  expect(general(BUILTIN, []).result.current.defaults.fixed).toBe(
    'A capability of the built-in admin client is never handed to every new subject.',
  );
});

it('says in the consequence what deleting takes from the caller, and reads whoami again after', async () => {
  const { result, sent } = general(REACHING, ['view-users']);
  await waitFor(() => {
    expect(result.current.deletion.checking).toBe(false);
  });
  expect(result.current.deletion.consequence).toContain(
    'If you hold view-users through auditor, this takes it from you, and this console with it.',
  );
  const before = whoamiReads(sent);
  act(() => {
    result.current.deletion.ask();
  });
  expect(result.current.deletion.confirming).toBe(true);
  act(() => {
    result.current.deletion.confirm();
  });
  await waitFor(() => {
    expect(sent.some((request) => request.method === 'DELETE')).toBe(true);
    expect(whoamiReads(sent)).toBeGreaterThan(before);
  });
});

it('adds nothing to the consequence and reads nothing again when deleting takes nothing', async () => {
  const { result, sent } = general(PLAIN, ['view-users']);
  await waitFor(() => {
    expect(result.current.deletion.checking).toBe(false);
  });
  expect(result.current.deletion.consequence).not.toContain('this takes it from you');
  const before = whoamiReads(sent);
  act(() => {
    result.current.deletion.ask();
  });
  act(() => {
    result.current.deletion.confirm();
  });
  await waitFor(() => {
    expect(sent.some((request) => request.method === 'DELETE')).toBe(true);
  });
  expect(whoamiReads(sent)).toBe(before);
});
