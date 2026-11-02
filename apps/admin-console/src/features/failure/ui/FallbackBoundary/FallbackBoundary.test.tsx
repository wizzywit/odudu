import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { FallbackBoundary } from '#/features/failure/ui/FallbackBoundary';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

afterEach(() => {
  vi.restoreAllMocks();
});

function Throws(): ReactNode {
  throw new Error('the failure screen failed');
}

const REPORT = { id: 'ABCD2345', route: '/', time: 't' };

it('shows what it wraps while that draws, and records nothing', () => {
  const record = vi.fn();
  render(
    <FallbackBoundary first={new Error('first')} record={record}>
      <p>the failure screen</p>
    </FallbackBoundary>,
  );
  expect(screen.getByText('the failure screen')).toBeVisible();
  expect(record).not.toHaveBeenCalled();
});

it('records the first error, not the second, and shows the minimal page under that id', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const first = new Error('first');
  const record = vi.fn<(error: unknown) => typeof REPORT>(() => REPORT);
  render(
    <FallbackBoundary first={first} record={record}>
      <Throws />
    </FallbackBoundary>,
  );
  await waitFor(() => {
    expect(screen.getByText('Error ID: ABCD2345')).toBeVisible();
  });
  expect(record).toHaveBeenCalledOnce();
  expect(record.mock.calls[0]?.[0]).toBe(first);
});

it('passes axe in both themes', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(
    await axeInBothThemes(() => (
      <FallbackBoundary first={new Error('x')} record={() => REPORT}>
        <Throws />
      </FallbackBoundary>
    )),
  ).toEqual({ light: [], dark: [] });
});
