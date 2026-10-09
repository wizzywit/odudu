import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePickerHolders } from '#/features/system-admins/repository/usePickerHolders.ts';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';

const SUBJECTS = 'GET /console/api/admin/tenants/system/subjects';

afterEach(() => {
  vi.restoreAllMocks();
});

function subject(id: string) {
  return {
    id,
    type: 'user',
    username: id,
    email: null,
    enabled: true,
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

// Every page names one holder and points at the next, up to `pages` of them.
function holders(pages: number) {
  const fake = fakeTransport({
    [SUBJECTS]: (request) => {
      const at = Number(request.search.get('cursor') ?? '0');
      const next = at + 1 < pages ? { next: String(at + 1) } : {};
      return json({ items: [subject(`h${String(at)}`)], ...next })(request);
    },
  });
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </TransportContext>
  );
  return { fake, wrapper };
}

it('follows the holders to their last page', async () => {
  const { fake, wrapper } = holders(3);
  const { result } = renderHook(() => usePickerHolders(''), { wrapper });
  await waitFor(() => {
    expect(result.current).toEqual(new Set(['h0', 'h1', 'h2']));
  });
  expect(fake.sent.every((s) => s.search.get('capability') === 'any')).toBe(true);
});

it('stops after ten pages, saying so as a console defect', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { fake, wrapper } = holders(12);
  const { result } = renderHook(() => usePickerHolders(''), { wrapper });
  await waitFor(() => {
    expect(result.current?.size).toBe(10);
  });
  expect(fake.sent).toHaveLength(10);
  expect(error).toHaveBeenCalledWith(expect.stringMatching(/^console defect: .*ten pages/u));
});
