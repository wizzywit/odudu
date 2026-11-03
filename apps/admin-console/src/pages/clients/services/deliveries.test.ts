import { expect, it } from 'vitest';
import { deliveryRow, deliveryTone } from '#/pages/clients/services/deliveries';

it('shows a failed delivery as danger, a pending one as a warning and a delivered one as active', () => {
  expect(deliveryTone('failed')).toBe('danger');
  expect(deliveryTone('pending')).toBe('warning');
  expect(deliveryTone('delivered')).toBe('active');
});

it('reads a delivery as its table does: the tone of its status, its attempts counted', () => {
  expect(
    deliveryRow({
      id: 'd1',
      session_id: 's1',
      endpoint: 'https://app.example/logout',
      status: 'failed',
      attempts: 3,
      last_error: 'timeout',
      created_at: '2026-10-01T08:00:00.000Z',
      next_attempt_at: '2026-10-01T09:00:00.000Z',
      delivered_at: null,
    }),
  ).toEqual({
    id: 'd1',
    endpoint: 'https://app.example/logout',
    status: 'failed',
    tone: 'danger',
    attempts: '3 attempts',
    lastError: 'timeout',
    createdAt: '2026-10-01T08:00:00.000Z',
  });
});
