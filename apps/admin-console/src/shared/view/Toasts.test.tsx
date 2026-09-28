import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Toast } from '#/shared/service/toast.ts';
import { Toasts } from '#/shared/view/Toasts.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const SAVED: Toast = { id: 't1', tone: 'success', message: 'Client saved' };
const FAILED: Toast = { id: 't2', tone: 'error', message: 'The server could not be reached' };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

it('announces toasts politely inside a named region', () => {
  render(<Toasts toasts={[SAVED, FAILED]} onDismiss={vi.fn()} />);
  const region = screen.getByRole('region', { name: 'Notifications' });
  const live = region.querySelector('[aria-live]');
  expect(live).toHaveAttribute('aria-live', 'polite');
  expect(live).toHaveTextContent('Client saved');
  expect(live).toHaveTextContent('The server could not be reached');
});

it('dismisses a success after five seconds', () => {
  const onDismiss = vi.fn();
  render(<Toasts toasts={[SAVED]} onDismiss={onDismiss} />);
  advance(4_999);
  expect(onDismiss).not.toHaveBeenCalled();
  advance(1);
  expect(onDismiss).toHaveBeenCalledWith('t1');
});

it('pauses the countdown while the pointer rests on the toast', () => {
  const onDismiss = vi.fn();
  render(<Toasts toasts={[SAVED]} onDismiss={onDismiss} />);
  advance(3_000);
  fireEvent.mouseEnter(screen.getByText('Client saved'));
  advance(10_000);
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByText('Client saved'));
  advance(1_999);
  expect(onDismiss).not.toHaveBeenCalled();
  advance(1);
  expect(onDismiss).toHaveBeenCalledWith('t1');
});

it('pauses the countdown while focus is inside the toast', () => {
  const onDismiss = vi.fn();
  render(<Toasts toasts={[SAVED]} onDismiss={onDismiss} />);
  advance(1_000);
  const dismiss = screen.getByRole('button', { name: 'Dismiss: Client saved' });
  act(() => {
    dismiss.focus();
  });
  advance(30_000);
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => {
    dismiss.blur();
  });
  advance(4_000);
  expect(onDismiss).toHaveBeenCalledWith('t1');
});

it('keeps an error until it is dismissed', () => {
  const onDismiss = vi.fn();
  render(<Toasts toasts={[FAILED]} onDismiss={onDismiss} />);
  advance(120_000);
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss: The server could not be reached' }));
  expect(onDismiss).toHaveBeenCalledWith('t2');
});

it('passes axe in both themes', async () => {
  vi.useRealTimers();
  expect(
    await axeInBothThemes(() => <Toasts toasts={[SAVED, FAILED]} onDismiss={vi.fn()} />),
  ).toEqual({ light: [], dark: [] });
});
