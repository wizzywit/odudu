import { QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { createReadCache } from '#/shared/lib/repository/readCache';
import { TransportContext } from '#/shared/api/transport/useTransport';
import { fakeTransport, type Answer } from '#/testing/fakeTransport';

// The wrapper a repository hook needs: a fake transport answering `routes`
// and a query client whose invalidations can be asserted. `transport` replaces
// the fake one where the test needs requests that reject.
export function hookHarness(
  routes: Record<string, Answer>,
  transport?: ReturnType<typeof fakeTransport>['transport'],
) {
  const fake = fakeTransport(routes);
  const queryClient = createReadCache();
  const invalidated = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={transport ?? fake.transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportContext>
  );
  return { ...fake, queryClient, invalidated, wrapper };
}

// A transport whose requests reject, as a send that throws rather than answers.
export function rejectingTransport(): ReturnType<typeof fakeTransport>['transport'] {
  const { transport } = fakeTransport({});
  return {
    ...transport,
    gateway: {
      ...transport.gateway,
      request: () => Promise.reject(new Error('the send threw')),
    },
  };
}
