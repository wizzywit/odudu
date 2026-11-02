import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '#/shared/ui/Button';
import { AskedDialog, ConfirmDialog } from '#/shared/ui/ConfirmDialog/ConfirmDialog';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

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
      'or press Enter',
    );
    expect(screen.getByText('or press', { exact: false })).toBeVisible();
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

it('holds its action while held, however it was confirmed', async () => {
  render(
    <ConfirmDialog
      isOpen
      title="Revoke ada?"
      consequence="ada loses tenant-admin."
      confirmLabel="Revoke"
      typed="ada"
      held
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox'), 'ada');
  expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
});

describe('an asked dialog', () => {
  const ASKED = { title: 'Take it out?', consequence: 'It is taken from every subject.' };

  it('is shut while nothing is asked, and open with what was asked', () => {
    const { rerender } = render(
      <AskedDialog
        asked={null}
        confirmLabel="Take it out"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    rerender(
      <AskedDialog
        asked={ASKED}
        confirmLabel="Take it out"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Take it out?' });
    expect(dialog).toHaveTextContent('It is taken from every subject.');
    expect(screen.getByRole('button', { name: 'Take it out' })).toBeVisible();
  });

  it('confirms and cancels through the handlers it is given', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <AskedDialog
        asked={ASKED}
        confirmLabel="Take it out"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Take it out' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('holds the confirm until what the ask says to type is typed', async () => {
    const user = userEvent.setup();
    render(
      <AskedDialog
        asked={{ ...ASKED, typed: 'manage-tenants' }}
        confirmLabel="Save"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'manage-tenants');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('asks nothing to be typed where the ask names none', () => {
    render(
      <AskedDialog
        asked={{ ...ASKED, typed: null }}
        confirmLabel="Save"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('takes the label, the tone and the busy state of the ask it is given', () => {
    render(
      <AskedDialog
        asked={{ ...ASKED, confirmLabel: 'Revoke it', tone: 'primary' }}
        busy
        problem="Not now."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Not now.');
  });
});

describe('a confirmation that offers a choice', () => {
  function Choosing({ onConfirm }: { onConfirm: (ticked: boolean) => void }) {
    const [ticked, setTicked] = useState(true);
    return (
      <AskedDialog
        asked={{
          title: 'Revoke the codes?',
          consequence: 'They stop working.',
          confirmLabel: 'Revoke',
          choice: { label: 'Ask for a new set', note: 'At the next sign-in.' },
        }}
        choice={{ checked: ticked, onChange: setTicked }}
        onConfirm={() => {
          onConfirm(ticked);
        }}
        onCancel={vi.fn()}
      />
    );
  }

  it('draws it with its note, in the state it was given, and reports a change', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Choosing onConfirm={onConfirm} />);
    const box = screen.getByRole('checkbox', { name: 'Ask for a new set' });
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription('At the next sign-in.');
    await user.click(box);
    expect(box).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('draws none when the one asking has no state for it', () => {
    render(
      <AskedDialog
        asked={{
          title: 'T',
          consequence: 'C',
          confirmLabel: 'Go',
          choice: { label: 'Ask for a new set', note: 'n' },
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('passes axe in both themes', async () => {
    expect(await axeInBothThemes(() => <Choosing onConfirm={vi.fn()} />)).toEqual({
      light: [],
      dark: [],
    });
  });
});
