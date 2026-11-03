import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useLockoutsClearAction } from '#/features/settings/use-cases/useLockoutsClear';
import { json, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const CLEAR = `DELETE ${ACME_ADMIN}/lockouts`;

function clearing(capabilities: readonly string[], answer = json({})) {
  const harness = hookHarness({
    [`GET ${ACME_ADMIN}/whoami`]: whoami(capabilities),
    [CLEAR]: answer,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return { ...harness, ...renderHook(() => useLockoutsClearAction('acme'), { wrapper }) };
}

it('waits for whoami, then offers the clear to a holder of manage-users', async () => {
  const { result } = clearing(['manage-users']);
  expect(result.current.state).toBe('checking');
  await waitFor(() => {
    expect(result.current.state).toBe('ready');
  });
});

it('says a lack is a lack once whoami answers without manage-users', async () => {
  const { result } = clearing(['manage-tenant']);
  await waitFor(() => {
    expect(result.current.state).toBe('lacking');
  });
});

it('asks first, names the tenant in what it says, and sends nothing until confirmed', async () => {
  const { result, sent } = clearing(
    ['manage-users'],
    json({ cleared: 2, beyond_ceiling: 0, remaining: 0 }),
  );
  await waitFor(() => {
    expect(result.current.state).toBe('ready');
  });
  expect(result.current.consequence).toContain('every lockout in acme');
  act(() => {
    result.current.ask();
  });
  expect(result.current.confirming).toBe(true);
  expect(sent.some((call) => call.method === 'DELETE')).toBe(false);
  act(() => {
    result.current.confirm();
  });
  await waitFor(() => {
    expect(sent.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
  expect(result.current.confirming).toBe(false);
  expect(result.current.more).toBeNull();
});

it('keeps a note beside the action while more lockouts are left', async () => {
  const { result } = clearing(
    ['manage-users'],
    json({ cleared: 10000, beyond_ceiling: 0, remaining: 40 }),
  );
  await waitFor(() => {
    expect(result.current.state).toBe('ready');
  });
  act(() => {
    result.current.ask();
  });
  act(() => {
    result.current.confirm();
  });
  await waitFor(() => {
    expect(result.current.more).not.toBeNull();
  });
  expect(result.current.more).toBe(
    'More failed sign-ins are left in acme: clear every lockout again to clear the next 10,000.',
  );
});

it('words a refusal naming manage-users and keeps the dialog open', async () => {
  const { result } = clearing(['manage-users'], problem(403, 'about:blank', 'Forbidden'));
  await waitFor(() => {
    expect(result.current.state).toBe('ready');
  });
  act(() => {
    result.current.ask();
  });
  act(() => {
    result.current.confirm();
  });
  await waitFor(() => {
    expect(result.current.problem).toContain('manage-users');
  });
});
