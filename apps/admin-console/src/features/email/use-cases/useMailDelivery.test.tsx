import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useMailDelivery } from '#/features/email/use-cases/useMailDelivery';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';
import { MAIL, mailMessage } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
});

function delivery(items: readonly unknown[]) {
  const harness = hookHarness({ [`GET ${MAIL}`]: json({ items }) });
  return {
    ...harness,
    ...renderHook(() => useMailDelivery('acme'), { wrapper: harness.wrapper }),
  };
}

it('reads one bounded page of any status to begin with', async () => {
  const { result, sent } = delivery([mailMessage('m1', 'sent')]);
  await waitFor(() => {
    expect(result.current.list.status).toBe('ready');
  });
  expect(sent[0]?.search.get('limit')).toBe('20');
  expect(sent[0]?.search.has('status')).toBe(false);
  expect(result.current.status).toBe('any');
});

it('asks again with the status chosen, and with none again for any', async () => {
  const { result, sent } = delivery([mailMessage('m1', 'failed')]);
  await waitFor(() => {
    expect(result.current.list.status).toBe('ready');
  });
  act(() => {
    result.current.setStatus('failed');
  });
  await waitFor(() => {
    expect(sent.some((call) => call.search.get('status') === 'failed')).toBe(true);
  });
  act(() => {
    result.current.setStatus('any');
  });
  await waitFor(() => {
    expect(sent.filter((call) => !call.search.has('status')).length).toBeGreaterThan(0);
  });
});

it('says recipients are shortened when any listed address is', async () => {
  const masked = delivery([mailMessage('m1', 'sent')]);
  await waitFor(() => {
    expect(masked.result.current.list.status).toBe('ready');
  });
  expect(masked.result.current.masked).toBe(true);
  const whole = delivery([mailMessage('m2', 'sent', { to: 'ada@example.org', to_masked: false })]);
  await waitFor(() => {
    expect(whole.result.current.list.status).toBe('ready');
  });
  expect(whole.result.current.masked).toBe(false);
});

it('names the oldest message still waiting in a complete, unfiltered list', async () => {
  const { result } = delivery([
    mailMessage('m3', 'sent'),
    mailMessage('m2', 'queued', { created_at: '2026-10-11T07:00:00.000Z' }),
  ]);
  await waitFor(() => {
    expect(result.current.list.status).toBe('ready');
  });
  expect(result.current.oldestWaiting).toBe('2026-10-11T07:00:00.000Z');
});
