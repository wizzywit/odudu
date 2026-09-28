import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import {
  rememberedTenant,
  useSessionQuery,
} from '#/features/session/repository/useSessionQuery.ts';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';

it('drops every other cached read when the session is marked ended', async () => {
  const { transport } = fakeTransport({
    'GET /console/api/session': json({ tenant: 'acme', subject_id: 's1', username: 'grace' }),
  });
  const client = createQueryClient();
  client.setQueryData(['whoami', 'acme'], { ok: true });
  client.setQueryData(['clients', 'acme'], { ok: true });
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <TransportContext value={transport}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </TransportContext>
  );
  const { result } = renderHook(() => useSessionQuery(), { wrapper });
  await waitFor(() => {
    expect(result.current.result?.ok).toBe(true);
  });

  act(() => {
    result.current.markEnded();
  });

  expect(client.getQueryData(['whoami', 'acme'])).toBeUndefined();
  expect(client.getQueryData(['clients', 'acme'])).toBeUndefined();
  expect(client.getQueryData(['session'])).toMatchObject({ ok: false });
  await waitFor(() => {
    expect(result.current.result).toMatchObject({ ok: false, problem: { status: 401 } });
  });
});

afterEach(() => {
  localStorage.clear();
});

it('offers the last tenant only when the URL names none and nobody is signed in', () => {
  localStorage.setItem('odudu.console.tenant', 'acme');
  expect(rememberedTenant({ named: null, signedIn: false })).toBe('acme');
  expect(rememberedTenant({ named: 'beta', signedIn: false })).toBeNull();
  expect(rememberedTenant({ named: null, signedIn: true })).toBeNull();
});

it('offers nothing when no tenant was remembered', () => {
  expect(rememberedTenant({ named: null, signedIn: false })).toBeNull();
});
