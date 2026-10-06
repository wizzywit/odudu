import { expect, it } from 'vitest';
import {
  ANY_STATUS,
  attemptsText,
  deliveryTone,
  statusFilter,
} from '#/features/clients/service/deliveries.ts';

it('sends no filter for any status, and the status itself otherwise', () => {
  expect(statusFilter(ANY_STATUS)).toBeNull();
  expect(statusFilter('failed')).toBe('failed');
});

it('shows a failed delivery as danger, a pending one as a warning and a delivered one as active', () => {
  expect(deliveryTone('failed')).toBe('danger');
  expect(deliveryTone('pending')).toBe('warning');
  expect(deliveryTone('delivered')).toBe('active');
});

it('counts attempts in words', () => {
  expect(attemptsText(1)).toBe('1 attempt');
  expect(attemptsText(0)).toBe('0 attempts');
  expect(attemptsText(5)).toBe('5 attempts');
});
