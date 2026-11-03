import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  rememberedTenant,
  useSessionEvent,
  useSessionQuery,
} from '#/entities/session/repository/useSessionQuery';
import { createReadCache } from '#/shared/repository/readCache';
import { sessionKey } from '#/shared/repository/queryKeys';
import { TransportContext } from '#/shared/transport/useTransport';
import { fakeTransport, json } from '#/testing/fakeTransport';

it('drops every other cached read when the session is marked ended', async () => {
  const { transport } = fakeTransport({
    'GET /console/api/session': json({ tenant: 'acme', subject_id: 's1', username: 'grace' }),
  });
  const client = createReadCache();
  client.setQueryData(['whoami', 'acme'], { ok: true });
  client.setQueryData(['clients', 'acme'], { ok: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={transport}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </TransportContext>
  );
  const { result } = renderHook(() => useSessionQuery(), { wrapper });
  await waitFor(() => {
    expect(result.current.read?.result.ok).toBe(true);
  });

  act(() => {
    result.current.markEnded(null);
  });

  expect(client.getQueryData(['whoami', 'acme'])).toBeUndefined();
  expect(client.getQueryData(['clients', 'acme'])).toBeUndefined();
  expect(client.getQueryData(sessionKey())).toMatchObject({ result: { ok: false } });
  await waitFor(() => {
    expect(result.current.read?.result).toMatchObject({ ok: false, problem: { status: 401 } });
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

it('tells the listener of the latest render, and stops once unmounted', () => {
  const { transport } = fakeTransport({});
  const { events } = transport;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={transport}>{children}</TransportContext>
  );
  const first = vi.fn();
  const second = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ listener }) => {
      useSessionEvent('authEnded', listener);
    },
    { wrapper, initialProps: { listener: first } },
  );
  rerender({ listener: second });
  events.emit('authEnded');
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
  unmount();
  events.emit('authEnded');
  expect(second).toHaveBeenCalledOnce();
});
