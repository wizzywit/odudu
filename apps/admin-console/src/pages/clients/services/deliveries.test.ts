import { expect, it } from 'vitest';
import { deliveryTone } from '#/pages/clients/services/deliveries';

it('shows a failed delivery as danger, a pending one as a warning and a delivered one as active', () => {
  expect(deliveryTone('failed')).toBe('danger');
  expect(deliveryTone('pending')).toBe('warning');
  expect(deliveryTone('delivered')).toBe('active');
});
