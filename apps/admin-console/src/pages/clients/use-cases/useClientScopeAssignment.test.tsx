import { clientSchema } from '@odudu/contracts/admin';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useClientScopeAssignment } from '#/pages/clients/use-cases/useClientScopeAssignment';
import { recordKey } from '#/shared/lib/repository/queryKeys';
import { useToasts } from '#/shared/lib/repository/useToasts';
import { BILLING, C } from '#/testing/clientsFixtures';
import { json, problem, type Answer } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { BILLING_SCOPE, SC } from '#/testing/scopesFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const CLIENT = clientSchema.parse(BILLING);
const PUT = `PUT ${SC}/s-bill/clients/c-bill`;
const DELETE = `DELETE ${SC}/s-bill/clients/c-bill`;
const HELD = { id: 's-bill', name: 'billing', assignment: 'default' as const };
const ASSIGNED = json({
  client_id: 'c-bill',
  scopes: [{ id: 's-bill', name: 'billing', assignment: 'optional' }],
});

afterEach(() => {
  useToasts.setState({ toasts: [], nextId: 1 });
});

function assigning(extra: Record<string, Answer> = {}) {
  const harness = hookHarness({
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['manage-tenant']),
    [`GET ${SC}`]: json({ items: [BILLING_SCOPE] }),
    [`GET ${C}/c-bill`]: json(BILLING, 200, { etag: '"c-bill-1"' }),
    ...extra,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(
    () =>
      useClientScopeAssignment({
        tenant: 'acme',
        client: CLIENT,
        reach: { status: 'free' },
      }),
    { wrapper },
  );
  return { ...view, ...harness };
}

function messages(): string[] {
  return useToasts.getState().toasts.map((toast) => toast.message);
}

it('assigns the chosen scope as the assignment picked, and says so', async () => {
  const { result, sent } = assigning({ [PUT]: ASSIGNED });
  await waitFor(() => {
    expect(result.current.picker.options).toHaveLength(1);
  });
  act(() => {
    result.current.choose(['s-bill']);
  });
  act(() => {
    result.current.setAssignment('optional');
  });
  expect(result.current.chosen?.id).toBe('s-bill');
  let went = false;
  await act(async () => {
    went = await result.current.assign();
  });
  expect(went).toBe(true);
  expect(sent.find((request) => request.method === 'PUT')?.body).toEqual({
    assignment: 'optional',
  });
  expect(messages()).toEqual(['billing is assigned to Billing as optional.']);
  expect(result.current.chosen).toBeNull();
});

it('takes one change at a time', async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { result, sent } = assigning({
    [DELETE]: async () => {
      await held;
      return new Response(null, { status: 204 });
    },
  });
  act(() => {
    result.current.remove(HELD).catch(() => undefined);
  });
  await waitFor(() => {
    expect(result.current.working).toBe('s-bill');
  });
  let second = true;
  await act(async () => {
    second = await result.current.remove(HELD);
  });
  expect(second).toBe(false);
  expect(sent.filter((request) => request.method === 'DELETE')).toHaveLength(1);
  await act(async () => {
    release();
    await held;
  });
  await waitFor(() => {
    expect(result.current.working).toBeNull();
  });
});

it('reads the client again when the ceiling refuses, and says why', async () => {
  const { result, invalidated } = assigning({
    [PUT]: problem(403, 'about:blank', 'Forbidden', {
      detail: "the client's service account holds what the caller does not: manage-users",
    }),
  });
  let went = true;
  await act(async () => {
    went = await result.current.change(HELD, 'optional');
  });
  expect(went).toBe(false);
  expect(invalidated).toHaveBeenCalledWith(
    expect.objectContaining({ queryKey: recordKey('acme', 'clients/c-bill'), exact: true }),
  );
  expect(result.current.message).toContain('holds what the caller does not');
});

it('says a scope is no longer assigned once it is removed', async () => {
  const { result, sent } = assigning({ [DELETE]: () => new Response(null, { status: 204 }) });
  await act(async () => {
    await result.current.remove(HELD);
  });
  expect(sent.some((request) => request.method === 'DELETE')).toBe(true);
  expect(messages()).toEqual(['billing is no longer assigned to Billing.']);
});
