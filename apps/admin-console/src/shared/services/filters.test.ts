import { expect, it } from 'vitest';
import { ANY_STATUS, optionalFilter, statusFilter } from '#/shared/services/filters';

it('sends a filter only when it names something', () => {
  expect(optionalFilter('status', 'failed')).toEqual({ status: 'failed' });
  expect(optionalFilter('status', null)).toEqual({});
  expect(optionalFilter('client', undefined)).toEqual({});
});

it('sends no status filter for any status, and the status itself otherwise', () => {
  expect(statusFilter(ANY_STATUS)).toBeNull();
  expect(statusFilter('failed')).toBe('failed');
});
