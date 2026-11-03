import { afterEach, expect, it, vi } from 'vitest';
import {
  inDevelopment,
  logFailure,
  newFailureReport,
  recordFailure,
} from '#/widgets/failure/repository/failureReport';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('draws its id from the browser CSPRNG, eight bytes of it', () => {
  const draw = vi.spyOn(crypto, 'getRandomValues');
  const report = newFailureReport('/$tenant');
  expect(draw).toHaveBeenCalledOnce();
  expect(draw.mock.calls[0]?.[0]).toHaveLength(8);
  expect(report.id).toMatch(/^[0-9A-Z]{8}$/u);
});

it('gives two failures two ids and stamps each with the time', () => {
  vi.useFakeTimers({ now: new Date('2026-10-22T09:30:15.123Z') });
  try {
    const first = newFailureReport('/');
    expect(first.time).toBe('2026-10-22T09:30:15.123Z');
    expect(newFailureReport('/').id).not.toBe(first.id);
  } finally {
    vi.useRealTimers();
  }
});

it('logs the id beside the whole error, and the component stack when it has one', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const error = new Error('whole');
  logFailure({ id: 'ABCD2345', route: '/', time: 't' }, 'rendering', error);
  expect(log).toHaveBeenCalledWith('odudu console failure ABCD2345 (rendering) at /', error);
  const report = recordFailure('caught', error, '/x', 'at Page');
  expect(log).toHaveBeenLastCalledWith(
    `odudu console failure ${report.id} (caught) at /x`,
    error,
    'at Page',
  );
});

it('reads the build mode when asked, so a production build can be stood in for', () => {
  vi.stubEnv('DEV', false);
  expect(inDevelopment()).toBe(false);
  vi.stubEnv('DEV', true);
  expect(inDevelopment()).toBe(true);
});
