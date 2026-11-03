import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { createReadCache } from '#/shared/repository/readCache';
import { recordKey } from '#/shared/repository/queryKeys';
import { useTenantSettings } from '#/entities/tenant/repository/useTenantSettings';
import { TENANT_SETTINGS_RECORD } from '#/entities/tenant/services/tenantSettings';
import { TransportContext } from '#/shared/transport/useTransport';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const GET = `GET ${ACME_ADMIN}/settings`;

it('reads the tenant settings under the record every section of them shares', async () => {
  const fake = fakeTransport({ [GET]: json({ display_name: 'Acme' }, 200, { etag: '"s1"' }) });
  const queryClient = createReadCache();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportContext>
  );
  const { result } = renderHook(() => useTenantSettings('acme'), { wrapper });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current.data).toEqual({ display_name: 'Acme' });
  expect(result.current.etag).toBe('"s1"');
  expect(queryClient.getQueryData(recordKey('acme', TENANT_SETTINGS_RECORD))).toBeDefined();
});
