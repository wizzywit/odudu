import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { recordKey, useRecord, type RecordEntry } from '#/shared/repository/useRecord.ts';
import type { Gateway } from '#/shared/transport/gateway.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { fakeTransport, inTurn, json, problem, type Answer } from '#/testing/fakeTransport.ts';

const GET = 'GET /console/api/admin/tenants/acme/clients/c1';
const schema = z.object({ name: z.string() });
const read = (gateway: Gateway) =>
  gateway.request('GET', 'admin/tenants/acme/clients/c1', { schema });

function harness(answer: Answer) {
  const fake = fakeTransport({ [GET]: answer });
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportContext>
  );
  const { result } = renderHook(() => useRecord({ tenant: 'acme', record: 'clients/c1', read }), {
    wrapper,
  });
  return { result, queryClient };
}

it('reads the record once, with its ETag', async () => {
  const { result } = harness(json({ name: 'Billing portal' }, 200, { etag: '"e1"' }));
  expect(result.current.status).toBe('loading');
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current.data).toEqual({ name: 'Billing portal' });
  expect(result.current.etag).toBe('"e1"');
  expect(result.current.updated).toBe(false);
});

it('tells a record that is not there apart from one that could not be read', async () => {
  const missing = harness(problem(404, 'about:blank#not-found', 'Not Found'));
  await waitFor(() => {
    expect(missing.result.current.status).toBe('missing');
  });
  const failed = harness(problem(500, 'about:blank', 'Internal Server Error'));
  await waitFor(() => {
    expect(failed.result.current.status).toBe('failed');
  });
});

it('says the record changed when a later read brings a new ETag, until acknowledged', async () => {
  const { result } = harness(
    inTurn(
      json({ name: 'Billing portal' }, 200, { etag: '"e1"' }),
      json({ name: 'Payments' }, 200, { etag: '"e2"' }),
    ),
  );
  await waitFor(() => {
    expect(result.current.etag).toBe('"e1"');
  });
  act(() => {
    result.current.retry();
  });
  await waitFor(() => {
    expect(result.current.updated).toBe(true);
  });
  act(() => {
    result.current.acknowledge();
  });
  expect(result.current.updated).toBe(false);
});

it('does not count a save made here as somebody else changing the record', async () => {
  const { result, queryClient } = harness(json({ name: 'Billing portal' }, 200, { etag: '"e1"' }));
  await waitFor(() => {
    expect(result.current.etag).toBe('"e1"');
  });
  const saved: RecordEntry<{ name: string }> = {
    result: { ok: true, status: 200, data: { name: 'Billing' }, etag: '"e2"', next: null },
    by: 'save',
  };
  act(() => {
    queryClient.setQueryData(recordKey('acme', 'clients/c1'), saved);
  });
  await waitFor(() => {
    expect(result.current.etag).toBe('"e2"');
  });
  expect(result.current.updated).toBe(false);
});
