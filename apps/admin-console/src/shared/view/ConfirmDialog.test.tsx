import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '#/shared/view/Button.tsx';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function Harness({ typed, onConfirm = vi.fn() }: { typed?: string; onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onPress={() => {
          setOpen(true);
        }}
      >
        Disable tenant
      </Button>
      <ConfirmDialog
        isOpen={open}
        title="Disable acme?"
        consequence="Nobody in acme can sign in until it is enabled again."
        confirmLabel="Disable acme"
        tone="danger"
        {...(typed === undefined ? {} : { typed })}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

describe('a plain confirmation', () => {
  it('is an alert dialog named by its question and described by its consequence', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Disable tenant' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Disable acme?' });
    expect(dialog).toHaveAccessibleDescription(
      'Nobody in acme can sign in until it is enabled again.',
    );
  });

  it('confirms, then returns focus to what opened it', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const trigger = screen.getByRole('button', { name: 'Disable tenant' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Disable acme' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it('cancels from its button and from Escape, returning focus each time', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const trigger = screen.getByRole('button', { name: 'Disable tenant' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('a typed confirmation', () => {
  it('enables its confirm only on the exact text, ignoring stray spaces', async () => {
    const user = userEvent.setup();
    render(<Harness typed="acme" />);
    await user.click(screen.getByRole('button', { name: 'Disable tenant' }));
    const confirm = screen.getByRole('button', { name: 'Disable acme' });
    const input = screen.getByRole('textbox', { name: 'Type acme to confirm' });
    expect(confirm).toBeDisabled();
    for (const attempt of ['acm', 'Acme', 'ACME', 'acmex']) {
      await user.clear(input);
      await user.type(input, attempt);
      expect(confirm).toBeDisabled();
    }
    for (const attempt of ['acme', 'acme ', ' acme']) {
      await user.clear(input);
      await user.type(input, attempt);
      expect(confirm).toBeEnabled();
    }
  });

  it('shows that Enter confirms from the field', async () => {
    const user = userEvent.setup();
    render(<Harness typed="acme" />);
    await user.click(screen.getByRole('button', { name: 'Disable tenant' }));
    expect(screen.getByRole('button', { name: 'Disable acme' })).toHaveAccessibleDescription(
      'Enter',
    );
    expect(screen.getByText('Enter', { selector: 'kbd' })).toBeVisible();
  });

  it('starts empty each time it opens', async () => {
    const user = userEvent.setup();
    render(<Harness typed="acme" />);
    await user.click(screen.getByRole('button', { name: 'Disable tenant' }));
    await user.type(screen.getByRole('textbox', { name: 'Type acme to confirm' }), 'acme');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Disable tenant' }));
    expect(screen.getByRole('textbox', { name: 'Type acme to confirm' })).toHaveValue('');
  });

  it('does not confirm on Enter before the text matches', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness typed="acme" onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Disable tenant' }));
    await user.type(screen.getByRole('textbox', { name: 'Type acme to confirm' }), 'acm{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Type acme to confirm' }), 'e{Enter}');
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

it('shows "Working…" and refuses a second confirm while busy', async () => {
  const onConfirm = vi.fn();
  const user = userEvent.setup();
  render(
    <ConfirmDialog
      isOpen
      title="Retire key k-7?"
      consequence="Tokens it signed stop verifying."
      confirmLabel="Retire key"
      tone="danger"
      busy
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  const confirm = screen.getByRole('button', { name: 'Working…' });
  expect(confirm).toBeDisabled();
  await user.click(confirm);
  expect(onConfirm).not.toHaveBeenCalled();
});

it('passes axe in both themes, plain and typed', async () => {
  for (const typed of [undefined, 'acme']) {
    expect(
      await axeInBothThemes(() => (
        <ConfirmDialog
          isOpen
          title="Disable acme?"
          consequence="Nobody in acme can sign in."
          confirmLabel="Disable acme"
          tone="danger"
          {...(typed === undefined ? {} : { typed })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      )),
    ).toEqual({ light: [], dark: [] });
  }
});

describe('a refusal', () => {
  const refusal = 'acme was not disabled: this would leave no enabled administrator.';

  function Refused() {
    return (
      <ConfirmDialog
        isOpen
        title="Disable acme?"
        consequence="Nobody in acme can sign in until it is enabled again."
        confirmLabel="Disable acme"
        tone="danger"
        typed="acme"
        problem={refusal}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
  }

  it('is said inside the dialog, beside the action it refused, as an alert', async () => {
    render(<Refused />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(refusal);
    expect(screen.getByRole('alertdialog')).toContainElement(alert);
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(
        () => <Refused />,
        () => screen.findByRole('alert'),
      ),
    ).toEqual({ light: [], dark: [] });
  });
});

it('holds its action once settled, however it was confirmed', async () => {
  render(
    <ConfirmDialog
      isOpen
      title="Revoke ada?"
      consequence="ada loses tenant-admin."
      confirmLabel="Revoke"
      typed="ada"
      settled
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox'), 'ada');
  expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
});
