import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { CreationActions, CreationForm, NameDescriptionFields } from '#/shared/ui/CreationForm';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const LIST = '/console/acme/roles';

function actions(overrides: Partial<Parameters<typeof CreationActions>[0]> = {}) {
  return (
    <CreationActions
      noun="role"
      lookFor="billing"
      busy={false}
      unconfirmed={false}
      onCheck={vi.fn()}
      listHref={LIST}
      message={null}
      {...overrides}
    />
  );
}

it('sends the form on submit and stops the page navigating', async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  render(<CreationForm submit={submit}>{actions()}</CreationForm>);
  await user.click(screen.getByRole('button', { name: 'Create role' }));
  expect(submit).toHaveBeenCalledOnce();
});

it('keeps the page from navigating on submit', () => {
  const { container } = render(<CreationForm submit={vi.fn()}>{actions()}</CreationForm>);
  const form = container.querySelector('form');
  if (form === null) throw new Error('no form');
  const event = createEvent.submit(form);
  fireEvent(form, event);
  expect(event.defaultPrevented).toBe(true);
});

it('puts the name and description fields to the page, with the limit when it has one', async () => {
  const user = userEvent.setup();
  const onName = vi.fn();
  render(
    <NameDescriptionFields
      nameHelp="Fixed once the role is made."
      name={{ value: '', error: 'Needs a name', onChange: onName }}
      description={{
        value: 'abc',
        error: undefined,
        onChange: vi.fn(),
        rule: 'Leave it empty for none.',
        limit: 10,
      }}
    />,
  );
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'b');
  expect(onName).toHaveBeenCalledWith('b');
  expect(screen.getByText('Fixed once the role is made.')).toBeVisible();
  expect(screen.getByText('Needs a name')).toBeVisible();
  expect(screen.getByText('3 of 10 characters.')).toBeVisible();
});

it('creates, or says it is creating, and gives the way back', () => {
  const { rerender } = render(actions());
  expect(screen.getByRole('button', { name: 'Create role' })).toBeEnabled();
  expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', LIST);
  rerender(actions({ busy: true }));
  expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
});

it('looks for what a lost answer may have made instead of creating again', async () => {
  const user = userEvent.setup();
  const onCheck = vi.fn();
  render(actions({ unconfirmed: true, onCheck }));
  expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Look for billing' }));
  expect(onCheck).toHaveBeenCalledOnce();
});

it('opens a partial copy, and says what it left out, instead of creating again', () => {
  render(
    actions({
      partial: { href: '/console/acme/roles/r2', name: 'billing', text: 'Two of three nested.' },
    }),
  );
  expect(screen.getByRole('link', { name: 'Open billing' })).toHaveAttribute(
    'href',
    '/console/acme/roles/r2',
  );
  expect(screen.getByText('Two of three nested.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
});

it('holds Create back, and says why beside it', () => {
  render(actions({ held: 'Needs a parent first.' }));
  const create = screen.getByRole('button', { name: 'Create role' });
  expect(create).toBeDisabled();
  expect(create).toHaveAccessibleDescription('Needs a parent first.');
});

it('says the last word, and shows nothing where there is none', () => {
  const { rerender } = render(actions({ message: 'That name is taken' }));
  expect(screen.getByRole('status')).toHaveTextContent('That name is taken');
  rerender(actions());
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

it('has no accessibility violations in either theme', async () => {
  expect(
    await axeInBothThemes(() => (
      <main>
        <CreationForm submit={vi.fn()}>
          <NameDescriptionFields
            nameHelp="Fixed once the role is made."
            name={{ value: '', error: undefined, onChange: vi.fn() }}
            description={{
              value: '',
              error: undefined,
              onChange: vi.fn(),
              rule: 'Leave it empty for none.',
            }}
          />
          {actions({ message: 'That name is taken' })}
        </CreationForm>
      </main>
    )),
  ).toEqual({ light: [], dark: [] });
});
