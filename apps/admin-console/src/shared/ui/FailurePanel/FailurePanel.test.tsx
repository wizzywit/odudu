import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { FailurePanel } from '#/shared/ui/FailurePanel';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const DETAILS = 'Error ID: ABCD2345\nPage: /$tenant\nTime: 2026-10-22T09:30:15.123Z';

function panel(message: string | null = null) {
  return (
    <FailurePanel
      kicker="Unexpected error"
      title="Something went wrong"
      text="This page could not be shown."
      message={message}
      messageLabel="Message"
      detailsHeading="Quote this"
      detailsLabel="error details"
      details={DETAILS}
      actions={<button type="button">Do it</button>}
    />
  );
}

it('moves focus to its heading, and makes only the one-sentence summary an alert', () => {
  render(panel());
  const heading = screen.getByRole('heading', { level: 1, name: 'Something went wrong' });
  expect(screen.getByRole('region', { name: 'Something went wrong' })).toBeVisible();
  expect(heading).toHaveFocus();
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('This page could not be shown.');
  expect(alert).not.toContainElement(screen.getByRole('button', { name: 'Do it' }));
});

it('announces nothing and takes no focus when it is a specimen', () => {
  render(
    <>
      <button type="button">before</button>
      <FailurePanel
        kicker="k"
        title="Something went wrong"
        text="t"
        message={null}
        messageLabel="m"
        detailsHeading="d"
        detailsLabel="error details"
        details={DETAILS}
        actions={null}
        announced={false}
      />
    </>,
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Something went wrong' })).not.toHaveFocus();
});

it('shows the message only when it is given one', () => {
  const { rerender } = render(panel());
  expect(screen.queryByText('boom')).toBeNull();
  rerender(panel('boom'));
  expect(screen.getByText('boom')).toBeVisible();
});

it('copies the details exactly as they are shown', async () => {
  const user = userEvent.setup();
  render(panel());
  expect(screen.getByRole('region', { name: 'error details' })).toHaveTextContent(
    /Error ID: ABCD2345/u,
  );
  await user.click(screen.getByRole('button', { name: 'Copy error details' }));
  expect(await navigator.clipboard.readText()).toBe(DETAILS);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => panel('boom'))).toEqual({ light: [], dark: [] });
});
