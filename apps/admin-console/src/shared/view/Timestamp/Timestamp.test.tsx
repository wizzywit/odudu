import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Timestamp } from '#/shared/view/Timestamp/Timestamp.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

afterEach(() => {
  vi.useRealTimers();
});

const NOW = new Date('2026-09-28T12:00:00Z');

it('shows the relative and the absolute time together', () => {
  render(<Timestamp value="2026-09-28T11:57:00Z" now={NOW} />);
  const time = screen.getByText('3 minutes ago').closest('time');
  expect(time).toHaveAttribute('datetime', '2026-09-28T11:57:00.000Z');
  expect(time?.textContent).toBe('3 minutes ago · 2026-09-28 11:57:00 UTC');
});

it('shows a value it cannot read as it came', () => {
  render(<Timestamp value="not a time" now={NOW} />);
  expect(screen.getByText('not a time')).toBeInTheDocument();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <Timestamp value="2026-09-28T11:57:00Z" now={NOW} />)).toEqual(
    { light: [], dark: [] },
  );
});

it('moves its relative time on as the clock does, with no parent render', () => {
  vi.useFakeTimers({ now: NOW });
  render(<Timestamp value="2026-09-28T11:57:00Z" />);
  expect(screen.getByText('3 minutes ago')).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(5 * 60_000);
  });
  expect(screen.getByText('8 minutes ago')).toBeInTheDocument();
});
