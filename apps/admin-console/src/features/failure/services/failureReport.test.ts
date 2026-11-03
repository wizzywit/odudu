import { expect, it } from 'vitest';
import {
  buildFailureReport,
  failureDetails,
  failureIdFrom,
  FAILURE_ID_LENGTH,
  shownMessage,
} from '#/features/failure/services/failureReport';

const NOW = new Date('2026-10-22T09:30:15.123Z');

it('makes an id of eight characters from an alphabet without look-alikes', () => {
  const id = failureIdFrom(Uint8Array.from([0, 1, 31, 32, 255, 100, 7, 200]));
  expect(id).toHaveLength(FAILURE_ID_LENGTH);
  expect(id).toBe('01Z0Z478');
});

it('draws every character with the same chance: a byte keeps its low five bits', () => {
  const seen = new Set<string>();
  for (let byte = 0; byte < 256; byte += 1) {
    seen.add(failureIdFrom(Uint8Array.from(Array.from({ length: 8 }, () => byte))).charAt(0));
  }
  expect(seen.size).toBe(32);
  expect([...seen].join('')).not.toMatch(/[ILOU]/u);
});

it('builds a report of the id, the route template and the time, and nothing else', () => {
  const report = buildFailureReport({
    bytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    route: '/$tenant/clients/$id',
    now: NOW,
  });
  expect(Object.keys(report).sort()).toEqual(['id', 'route', 'time']);
  expect(report.route).toBe('/$tenant/clients/$id');
  expect(report.time).toBe('2026-10-22T09:30:15.123Z');
});

it('copies exactly the id, the page template and the time', () => {
  const report = { id: 'ABCD2345', route: '/$tenant/clients/$id', time: NOW.toISOString() };
  expect(failureDetails(report)).toBe(
    ['Error ID: ABCD2345', 'Page: /$tenant/clients/$id', 'Time: 2026-10-22T09:30:15.123Z'].join(
      '\n',
    ),
  );
});

it('shows a message only in development, and only of an error that has one', () => {
  expect(shownMessage(new Error('secret detail'), true)).toBe('secret detail');
  expect(shownMessage(new Error('secret detail'), false)).toBeNull();
  expect(shownMessage('a thrown string', true)).toBe('a thrown string');
  expect(shownMessage(undefined, true)).toBeNull();
  expect(shownMessage(new Error(''), true)).toBeNull();
});
