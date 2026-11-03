import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAuditList } from '#/pages/audit/repository/useAuditList';
import { AUDIT, auditEvent } from '#/testing/auditFixtures';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';

const address = vi.hoisted(() => ({ search: '', go: vi.fn<(params: URLSearchParams) => void>() }));

vi.mock('#/shared/repository/useUrlSearch', () => ({
  useUrlSearch: () => ({
    params: new URLSearchParams(address.search),
    go: address.go,
    drop: vi.fn(),
  }),
}));

afterEach(() => {
  address.search = '';
  address.go.mockClear();
});

function list(search: string) {
  address.search = search;
  const harness = hookHarness({ [`GET ${AUDIT}`]: json({ items: [auditEvent()] }) });
  const view = renderHook(() => useAuditList('acme'), { wrapper: harness.wrapper });
  return { ...view, sent: harness.sent };
}

it('names a filter the address holds that the API would refuse, and reads without it', async () => {
  const { result, sent } = list('outcome=maybe&action=client.update');
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current.filters).toEqual({ action: 'client.update' });
  expect(result.current.ignored).toHaveLength(1);
  expect(result.current.ignored[0]).toMatch(/outcome/iu);
  const query = sent.at(-1)?.search;
  expect(query?.get('action')).toBe('client.update');
  expect(query?.has('outcome')).toBe(false);
});

it('sends the cursor the address holds, bound to the filters beside it', async () => {
  const { result, sent } = list('action=client.update&after=abc.def');
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current.trail).toEqual(['abc.def']);
  expect(sent.at(-1)?.search.get('cursor')).toBe('abc.def');
  expect(sent.at(-1)?.search.get('action')).toBe('client.update');
});

it('drops the trail from the address when a filter changes, and keeps what else it holds', async () => {
  const { result } = list('action=old&after=abc.def&tab=x');
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  act(() => {
    result.current.apply({ outcome: 'failed' });
  });
  const [search] = address.go.mock.calls[0] ?? [];
  expect(search?.get('outcome')).toBe('failed');
  expect(search?.has('action')).toBe(false);
  expect(search?.has('after')).toBe(false);
  expect(search?.get('tab')).toBe('x');
});
