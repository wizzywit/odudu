import { expect, it } from 'vitest';
import {
  deviceGroupLabel,
  deviceSizeOf,
  groupByDevice,
} from '#/entities/session/services/deviceGroups';

const row = (id: string, device: string | null) => ({ id, device });

it('puts the sessions of one device next to each other, in the order each device first appears', () => {
  const rows = [row('1', 'a'), row('2', 'b'), row('3', 'a'), row('4', 'c'), row('5', 'b')];
  expect(groupByDevice(rows).map((r) => r.id)).toEqual(['1', '3', '2', '5', '4']);
});

it('keeps the order within a device and puts sessions with no device last', () => {
  const rows = [row('1', null), row('2', 'a'), row('3', null), row('4', 'a')];
  expect(groupByDevice(rows).map((r) => r.id)).toEqual(['2', '4', '1', '3']);
});

it('returns an empty list for none and leaves the input alone', () => {
  const rows = [row('1', 'a')];
  expect(groupByDevice([])).toEqual([]);
  groupByDevice(rows);
  expect(rows).toEqual([row('1', 'a')]);
});

it('counts the rows each device has', () => {
  const size = deviceSizeOf([row('1', 'a'), row('2', 'a'), row('3', 'b'), row('4', null)]);
  expect(size('a')).toBe(2);
  expect(size('b')).toBe(1);
  expect(size(null)).toBe(1);
  expect(size('z')).toBe(0);
});

it('words a group by its count', () => {
  expect(deviceGroupLabel(1)).toBe('1 session on this device');
  expect(deviceGroupLabel(3)).toBe('3 sessions on this device');
});
