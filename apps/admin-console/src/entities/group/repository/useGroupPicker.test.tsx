import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { useGroupPicker } from '#/entities/group/repository/useGroupPicker';
import { createQueryClient } from '#/shared/repository/queryClient';
import { TransportContext } from '#/shared/transport/useTransport';
import { fakeTransport, problem, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const GROUPS = `GET ${ACME_ADMIN}/groups`;

function wrapperFor(routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportContext>
  );
  const asked = () => fake.sent.map((request) => `${request.path}?${request.search.toString()}`);
  return { wrapper, asked };
}

it('reads groups, and says when the list is refused', async () => {
  const { wrapper } = wrapperFor({ [GROUPS]: problem(403, 'about:blank', 'Forbidden') });
  const { result } = renderHook(() => useGroupPicker('acme'), { wrapper });
  await waitFor(() => {
    expect(result.current.status).toBe('refused');
  });
});
