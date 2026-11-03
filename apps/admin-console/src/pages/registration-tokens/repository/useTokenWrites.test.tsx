import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  useTokenMint,
  useTokenRevoke,
} from '#/pages/registration-tokens/repository/useTokenWrites';
import { json, problem } from '#/testing/fakeTransport';
import { hookHarness as harness } from '#/testing/hookHarness';
import { settledWriteContract } from '#/testing/settledWriteContract';
import { MINTED, MINTED_SECRET, RT } from '#/testing/tokensFixtures';

const told = () => ({ minted: vi.fn(), failed: vi.fn() });

it('hands the token to its dialog alone, tells on the rest, and reads the list again', async () => {
  const { wrapper, queryClient, invalidated } = harness({ [`POST ${RT}`]: json(MINTED, 201) });
  const callbacks = told();
  const { result } = renderHook(() => useTokenMint('acme', callbacks), { wrapper });
  act(() => {
    result.current.start({ uses: 3, ttl_seconds: 3600 });
  });
  await waitFor(() => {
    expect(result.current.secret).toBe(MINTED_SECRET);
  });
  expect(callbacks.minted).toHaveBeenCalledWith({
    id: 't-new',
    remaining_uses: 3,
    expires_at: '2026-10-12T21:00:00.000Z',
  });
  expect(JSON.stringify(callbacks.minted.mock.calls)).not.toContain(MINTED_SECRET);
  expect(
    JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    ),
  ).not.toContain(MINTED_SECRET);
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['list', 'acme', 'registration-tokens'] });
  act(() => {
    result.current.close();
  });
  expect(result.current.secret).toBeNull();
});

it('tells of a refusal and shows no secret', async () => {
  const { wrapper } = harness({ [`POST ${RT}`]: problem(403, 'about:blank', 'Forbidden') });
  const callbacks = told();
  const { result } = renderHook(() => useTokenMint('acme', callbacks), { wrapper });
  act(() => {
    result.current.start({ uses: 1, ttl_seconds: 60 });
  });
  await waitFor(() => {
    expect(callbacks.failed).toHaveBeenCalledTimes(1);
  });
  expect(result.current.secret).toBeNull();
  expect(callbacks.minted).not.toHaveBeenCalled();
});

it('sends a mint once for one press, however often it is pressed', async () => {
  const { wrapper, sent } = harness({ [`POST ${RT}`]: json(MINTED, 201) });
  const { result } = renderHook(() => useTokenMint('acme', told()), { wrapper });
  act(() => {
    result.current.start({ uses: 1, ttl_seconds: 60 });
    result.current.start({ uses: 1, ttl_seconds: 60 });
  });
  await waitFor(() => {
    expect(result.current.secret).toBe(MINTED_SECRET);
  });
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

settledWriteContract({
  noun: 'revoke',
  useWrite: useTokenRevoke,
  id: 't-1',
  request: `DELETE ${RT}/t-1`,
  refusal: problem(404, 'about:blank', 'Not Found'),
  listKey: ['list', 'acme', 'registration-tokens'],
});
