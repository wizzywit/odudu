import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rootErrorOptions } from '#/app/rootErrorOptions/rootErrorOptions';
import { RootBoundary } from '#/widgets/failure';
import { ChunkLoadError } from '#/shared/lib/services/chunkLoad';
import { ChunkBoundary } from '#/shared/ui/ChunkBoundary';
import { failingAt } from '#/testing/mountFailing';

const LINE = /^odudu console failure [0-9A-Z]{8} \((caught|uncaught|recoverable)\) at \/\$tenant$/u;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

function Throws({ error }: { error: unknown }): ReactNode {
  throw error;
}

function mount(element: ReactNode): void {
  root = createRoot(
    container,
    rootErrorOptions(() => '/$tenant'),
  );
  act(() => {
    root?.render(element);
  });
}

function logged(): string[] {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => String(call[0]))
    .filter((line) => line.startsWith('odudu console failure'));
}

it('logs a chunk failure the chunk boundary caught, which draws no id of its own', () => {
  mount(
    <ChunkBoundary onReload={vi.fn()}>
      <Throws error={new ChunkLoadError(new TypeError('Failed to fetch'))} />
    </ChunkBoundary>,
  );
  expect(logged()).toHaveLength(1);
  expect(logged()[0]).toMatch(LINE);
  expect(logged()[0]).toContain('(caught)');
});

it('leaves an error a panel caught to that panel, which logs it once under the id it shows', () => {
  mount(
    <RootBoundary route={() => '/$tenant'} record={vi.fn()}>
      <ChunkBoundary onReload={vi.fn()}>
        <Throws error={new Error('plain')} />
      </ChunkBoundary>
    </RootBoundary>,
  );
  const shown = String(/Error ID: ([0-9A-Z]{8})/u.exec(container.textContent)?.[1]);
  expect(shown).toMatch(/^[0-9A-Z]{8}$/u);
  expect(logged()).toEqual([`odudu console failure ${shown} (rendering) at /$tenant`]);
});

it('leaves an error a route panel caught to that panel, which logs it once under its id', async () => {
  mount(
    failingAt('/acme/clients', () => {
      throw new Error('plain');
    }),
  );
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Error ID');
  });
  const shown = String(/Error ID: ([0-9A-Z]{8})/u.exec(container.textContent)?.[1]);
  expect(shown).toMatch(/^[0-9A-Z]{8}$/u);
  expect(logged()).toEqual([`odudu console failure ${shown} (rendering) at /$tenant/clients`]);
});

// Inside act React rethrows an uncaught render error to the test instead of
// reporting it, so the callback is called as React calls it.
it('logs an error nothing caught, with an id and the component stack', () => {
  const { onUncaughtError } = rootErrorOptions(() => '/$tenant');
  onUncaughtError?.(new Error('nobody caught this'), { componentStack: '\n    at Page' });
  expect(logged()).toHaveLength(1);
  expect(logged()[0]).toMatch(LINE);
  expect(logged()[0]).toContain('(uncaught)');
});

it('logs what React recovered from, with an id', () => {
  const { onRecoverableError } = rootErrorOptions(() => '/$tenant');
  onRecoverableError?.(new Error('hydration'), { componentStack: '\n    at Page' });
  expect(logged()).toHaveLength(1);
  expect(logged()[0]).toMatch(LINE);
  expect(logged()[0]).toContain('(recoverable)');
  expect(console.error).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ message: 'hydration' }),
    '\n    at Page',
  );
});
