import { renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useMail } from '#/pages/email/repository/useMail';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { mailMessage } from '#/testing/settingsFixtures';

const path = 'GET /console/api/admin/tenants/acme/mail';

it('reads one bounded page of any status, then the status chosen under its own key', async () => {
  const { wrapper, sent, queryClient } = hookHarness({
    [path]: json({ items: [mailMessage('m1', 'queued')] }),
  });
  const { result, rerender } = renderHook(({ status }) => useMail('acme', status), {
    wrapper,
    initialProps: { status: null as string | null },
  });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(sent.map((s) => s.search.toString())).toEqual(['limit=20']);
  rerender({ status: 'failed' });
  await waitFor(() => {
    expect(sent.map((s) => s.search.toString())).toEqual(['limit=20', 'limit=20&status=failed']);
  });
  expect(queryClient.getQueryCache().findAll({ queryKey: ['list', 'acme', 'mail'] })).toHaveLength(
    2,
  );
});

it('is read again by a retry, and only by it', async () => {
  const { wrapper, sent } = hookHarness({ [path]: json({ items: [] }) });
  const { result } = renderHook(() => useMail('acme', null), { wrapper });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  result.current.retry();
  await waitFor(() => {
    expect(sent).toHaveLength(2);
  });
});
