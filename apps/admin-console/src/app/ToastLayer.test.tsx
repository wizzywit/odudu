import { act, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastLayer } from '#/app/ToastLayer.tsx';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';

afterEach(() => {
  useToasts.setState({ toasts: [] });
});

function hiddenFromAssistiveTechnology(node: Element): boolean {
  for (let at: Element | null = node; at !== null; at = at.parentElement) {
    if (at.getAttribute('aria-hidden') === 'true') return true;
    if (at instanceof HTMLElement && at.inert) return true;
  }
  return false;
}

// jsdom shows what React Aria marks hidden; whether a screen reader then
// speaks the alert is only observable in a real browser.
it('keeps an error raised while a modal is open where assistive technology can reach it', async () => {
  render(
    <>
      <main>
        <p>Clients</p>
      </main>
      <ToastLayer />
      <ConfirmDialog
        isOpen
        title="Delete client?"
        consequence="Its tokens stop working at once."
        confirmLabel="Delete client"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    </>,
  );
  await screen.findByRole('alertdialog', { name: 'Delete client?' });
  expect(hiddenFromAssistiveTechnology(screen.getByText('Clients'))).toBe(true);

  act(() => {
    useToasts.getState().push({ tone: 'error', message: 'The server could not be reached' });
  });

  const alert = within(document.body).getByText('The server could not be reached');
  expect(hiddenFromAssistiveTechnology(alert)).toBe(false);
  expect(alert.closest('[role="alert"]')).not.toBeNull();
});
