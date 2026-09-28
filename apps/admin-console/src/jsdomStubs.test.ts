import { afterEach, expect, it, vi } from 'vitest';

interface Stream {
  write(chunk: string | Uint8Array): boolean;
}

// The test runs in Node, but this package's types are the browser's alone.
const { stdout, stderr } = (
  globalThis as unknown as { process: { stdout: Stream; stderr: Stream } }
).process;

afterEach(() => {
  vi.restoreAllMocks();
});

it('lets the router scroll and axe probe a canvas without jsdom reporting it', () => {
  const reports: string[] = [];
  for (const stream of [stdout, stderr]) {
    vi.spyOn(stream, 'write').mockImplementation((chunk) => {
      reports.push(String(chunk));
      return true;
    });
  }
  window.scrollTo(0, 0);
  expect(document.createElement('canvas').getContext('2d')).toBeNull();
  vi.restoreAllMocks();
  expect(reports.filter((r) => r.includes('Not implemented'))).toEqual([]);
});
