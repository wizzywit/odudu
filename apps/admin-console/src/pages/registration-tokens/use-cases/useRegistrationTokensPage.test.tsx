import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useRegistrationTokensPage } from '#/pages/registration-tokens/use-cases/useRegistrationTokensPage';
import { json, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';
import { MINTED, MINTED_SECRET, RT, TOKEN_ONE, tokenRoutes } from '#/testing/tokensFixtures';

vi.mock('#/shared/repository/useUrlSearch', () => ({
  useUrlSearch: () => ({ params: new URLSearchParams(), go: vi.fn(), drop: vi.fn() }),
}));

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

function page(extra: Parameters<typeof tokenRoutes>[1] = {}) {
  const harness = hookHarness(tokenRoutes(undefined, extra));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return { ...harness, ...renderHook(() => useRegistrationTokensPage('acme'), { wrapper }) };
}

async function listed(result: { current: ReturnType<typeof useRegistrationTokensPage> }) {
  await waitFor(() => {
    expect(result.current.list.status).toBe('ready');
  });
}

it('shows a minted secret to its dialog once, and not again after it is closed', async () => {
  const { result, sent } = page({ [`POST ${RT}`]: json(MINTED, 201) });
  await listed(result);
  act(() => {
    result.current.mint();
  });
  await waitFor(() => {
    expect(result.current.secret).toBe(MINTED_SECRET);
  });
  expect(sent.find((call) => call.method === 'POST')?.body).toEqual({
    uses: 1,
    ttl_seconds: 3600,
  });
  act(() => {
    result.current.closeSecret();
  });
  expect(result.current.secret).toBeNull();
  await listed(result);
  expect(JSON.stringify(result.current.list)).not.toContain(MINTED_SECRET);
});

it('blocks minting with the range text when uses is out of range, and sends nothing', async () => {
  const { result, sent } = page();
  await listed(result);
  act(() => {
    result.current.editUses(0);
  });
  act(() => {
    result.current.mint();
  });
  expect(result.current.errors.uses).toBe('Uses is a whole number from 1 to 2,147,483,647.');
  expect(result.current.errors.ttl_seconds).toBeUndefined();
  expect(sent.some((call) => call.method === 'POST')).toBe(false);
});

it('blocks minting with the range text when the lifetime is out of range, and sends nothing', async () => {
  const { result, sent } = page();
  await listed(result);
  act(() => {
    result.current.editLifetime(59);
  });
  act(() => {
    result.current.mint();
  });
  expect(result.current.errors.ttl_seconds).toBe(
    'Lifetime is a whole number of seconds, from 60 seconds (1 minute) to 31536000 seconds (365 days).',
  );
  expect(sent.some((call) => call.method === 'POST')).toBe(false);
});

it('clears the error of a field once it is edited', async () => {
  const { result } = page();
  await listed(result);
  act(() => {
    result.current.editUses(0);
  });
  act(() => {
    result.current.mint();
  });
  act(() => {
    result.current.editUses(2);
  });
  expect(result.current.errors.uses).toBeUndefined();
});

it('names manage-clients when the server refuses a revoke', async () => {
  const { result } = page({
    [`DELETE ${RT}/${TOKEN_ONE.id}`]: problem(403, 'about:blank', 'Forbidden'),
  });
  await listed(result);
  act(() => {
    result.current.ask(TOKEN_ONE);
  });
  expect(result.current.consequence).toContain('Nobody can register a client with it again');
  await act(async () => {
    await result.current.confirm();
  });
  expect(result.current.revokeProblem).toContain('manage-clients');
  expect(result.current.revoking).not.toBeNull();
});

it('says the token is already gone when the server no longer has it', async () => {
  const { result } = page({
    [`DELETE ${RT}/${TOKEN_ONE.id}`]: problem(404, 'about:blank', 'Not Found'),
  });
  await listed(result);
  act(() => {
    result.current.ask(TOKEN_ONE);
  });
  await act(async () => {
    await result.current.confirm();
  });
  expect(result.current.notice).toContain('already gone');
});

it('names the page, its words and the label of a token’s revoke', async () => {
  const { result } = page();
  await listed(result);
  expect(result.current.title).toBe('Registration tokens');
  expect(result.current.words.mint.title).toBe('Mint a registration token');
  expect(result.current.revokeLabel(TOKEN_ONE)).toBe('Revoke t-one');
});
