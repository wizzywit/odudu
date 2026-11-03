import { expect, it } from 'vitest';
import { caughtIsLogged, failureLogLine } from '#/features/failure/services/failureLogging';

const NOW = new Date('2026-10-22T09:30:15.123Z');

it('puts the id, how it was met and the route on one line to match the error against', () => {
  const report = { id: 'ABCD2345', route: '/$tenant', time: NOW.toISOString() };
  expect(failureLogLine(report, 'rendering')).toBe(
    'odudu console failure ABCD2345 (rendering) at /$tenant',
  );
});

it('logs a caught error only where no panel shows the id already', () => {
  expect(caughtIsLogged('shows-id', false)).toBe(false);
  expect(caughtIsLogged('chunk', true)).toBe(true);
  // A chunk boundary throws any other error on, to a boundary that shows an id.
  expect(caughtIsLogged('chunk', false)).toBe(false);
  expect(caughtIsLogged('other', false)).toBe(true);
});
