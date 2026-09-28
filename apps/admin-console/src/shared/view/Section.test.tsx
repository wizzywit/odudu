import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Section } from '#/shared/view/Section.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function General(props: {
  dirty: boolean;
  saving?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
  restored?: boolean;
}) {
  return (
    <Section
      title="General"
      description="How the client is named to the people who sign in."
      dirty={props.dirty}
      saving={props.saving ?? false}
      onSave={props.onSave ?? vi.fn()}
      onDiscard={props.onDiscard ?? vi.fn()}
      restored={props.restored ?? false}
    >
      <label>
        Name
        <input name="name" defaultValue="Billing portal" />
      </label>
    </Section>
  );
}

it('is a region named by its heading', () => {
  render(<General dirty={false} />);
  const region = screen.getByRole('region', { name: 'General' });
  expect(within(region).getByRole('heading', { level: 2, name: 'General' })).toBeInTheDocument();
});

it('shows its save bar only while it has changes', () => {
  const { rerender } = render(<General dirty={false} />);
  expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  expect(screen.queryByText('Unsaved changes')).toBeNull();
  rerender(<General dirty />);
  expect(screen.getByRole('button', { name: 'Save General' })).toBeEnabled();
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
});

it('saves from the button and from Enter in a field, and shows the shortcut', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  const { rerender } = render(<General dirty onSave={onSave} />);
  await user.click(screen.getByRole('button', { name: 'Save General' }));
  rerender(<General dirty saving onSave={onSave} />);
  rerender(<General dirty onSave={onSave} />);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Enter}');
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Save General' })).toHaveAccessibleDescription('Enter');
  expect(screen.getByText('Enter', { selector: 'kbd' })).toBeVisible();
});

it('reads "Saving…" while the request is in flight, and nothing resubmits it', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<General dirty saving onSave={onSave} />);
  const button = screen.getByRole('button', { name: 'Saving… General' });
  expect(button).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Enter}');
  await user.click(button);
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Discard changes to General' })).toBeDisabled();
});

it('saves once for two submits that land before "saving" arrives', () => {
  const onSave = vi.fn();
  render(<General dirty onSave={onSave} />);
  const form = screen.getByRole('textbox', { name: 'Name' }).closest('form');
  act(() => {
    form?.requestSubmit();
    form?.requestSubmit();
  });
  expect(onSave).toHaveBeenCalledOnce();
});

it('saves again once the first save has finished', () => {
  const onSave = vi.fn();
  const { rerender } = render(<General dirty onSave={onSave} />);
  const form = () => screen.getByRole('textbox', { name: 'Name' }).closest('form');
  act(() => {
    form()?.requestSubmit();
  });
  rerender(<General dirty saving onSave={onSave} />);
  rerender(<General dirty onSave={onSave} />);
  act(() => {
    form()?.requestSubmit();
  });
  expect(onSave).toHaveBeenCalledTimes(2);
});

it('never saves when there is nothing to save', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<General dirty={false} onSave={onSave} />);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Enter}');
  expect(onSave).not.toHaveBeenCalled();
});

it('discards on request', async () => {
  const user = userEvent.setup();
  const onDiscard = vi.fn();
  render(<General dirty onDiscard={onDiscard} />);
  await user.click(screen.getByRole('button', { name: 'Discard changes to General' }));
  expect(onDiscard).toHaveBeenCalledOnce();
});

it('passes axe in both themes, clean and dirty', async () => {
  expect(await axeInBothThemes(() => <General dirty={false} />)).toEqual({ light: [], dark: [] });
  expect(await axeInBothThemes(() => <General dirty />)).toEqual({ light: [], dark: [] });
});

it('marks work restored after a sign-in, for review before it is saved', () => {
  const { rerender } = render(<General dirty />);
  const region = screen.getByRole('region', { name: 'General' });
  expect(within(region).queryByText('Restored — review before saving')).toBeNull();
  rerender(<General dirty restored />);
  expect(within(region).getByText('Restored — review before saving')).toBeVisible();
});
