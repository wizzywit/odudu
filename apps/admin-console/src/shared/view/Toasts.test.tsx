import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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

it('announces a success politely and an error as an alert, inside a named region', () => {
  render(<Toasts toasts={[SAVED, FAILED]} onDismiss={vi.fn()} />);
  const region = screen.getByRole('region', { name: 'Notifications' });
  const polite = region.querySelector('[aria-live="polite"]');
  expect(polite).toHaveTextContent('Client saved');
  expect(polite).not.toHaveTextContent('The server could not be reached');
  expect(within(region).getByRole('alert')).toHaveTextContent('The server could not be reached');
  expect(within(region).getAllByRole('alert')).toHaveLength(1);
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

function Queue({ initial }: { readonly initial: readonly Toast[] }) {
  const [toasts, setToasts] = useState(initial);
  return (
    <>
      <main id="main" tabIndex={-1}>
        Page
      </main>
      <Toasts
        toasts={toasts}
        onDismiss={(id) => {
          setToasts((queue) => queue.filter((t) => t.id !== id));
        }}
      />
    </>
  );
}

it('hands focus to the next toast, then to the page, as each is dismissed', async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  const third: Toast = { id: 't3', tone: 'error', message: 'Retry later' };
  render(<Queue initial={[FAILED, third]} />);
  await user.click(screen.getByRole('button', { name: `Dismiss: ${FAILED.message}` }));
  expect(screen.getByRole('button', { name: 'Dismiss: Retry later' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Dismiss: Retry later' }));
  expect(screen.getByRole('main')).toHaveFocus();
});

it('passes axe in both themes', async () => {
  vi.useRealTimers();
  expect(
    await axeInBothThemes(() => <Toasts toasts={[SAVED, FAILED]} onDismiss={vi.fn()} />),
  ).toEqual({ light: [], dark: [] });
});
