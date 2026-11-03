import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { EMPTY_DRAFT } from '#/features/audit/services/filterDraft';
import type { AuditFilterForm } from '#/features/audit/use-cases/useAuditPage';
import { AuditFilters } from '#/features/audit/ui/AuditFilters/AuditFilters';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function form(overrides: Partial<AuditFilterForm> = {}): AuditFilterForm {
  return {
    draft: EMPTY_DRAFT,
    problems: {},
    set: vi.fn(),
    report: vi.fn(),
    blocked: null,
    submit: vi.fn(),
    clear: vi.fn(),
    filtered: false,
    ...overrides,
  };
}

it('offers every filter the API takes, each labelled', () => {
  render(<AuditFilters form={form()} />);
  for (const name of ['Action', 'Resource type', 'Resource id', 'Actor (subject id)']) {
    expect(screen.getByRole('textbox', { name })).toBeVisible();
  }
  for (const name of ['Event type', 'Outcome']) {
    expect(screen.getByRole('button', { name: new RegExp(name, 'u') })).toBeVisible();
  }
  for (const name of ['From', 'To']) {
    expect(screen.getByLabelText(name)).toBeVisible();
  }
});

it('says what is not a filter, rather than offering it', () => {
  render(<AuditFilters form={form()} />);
  expect(screen.getByText(/request id, the address a request came from/u)).toBeVisible();
  expect(screen.queryByRole('textbox', { name: /request/iu })).toBeNull();
});

it('keeps the resource id out of reach until the draft has a resource type', () => {
  const { rerender } = render(<AuditFilters form={form()} />);
  expect(screen.getByRole('textbox', { name: 'Resource id' })).toBeDisabled();
  rerender(<AuditFilters form={form({ draft: { ...EMPTY_DRAFT, resource_type: 'client' } })} />);
  expect(screen.getByRole('textbox', { name: 'Resource id' })).toBeEnabled();
});

it('submits the form from the keyboard, and offers Clear only when there is something to clear', async () => {
  const user = userEvent.setup();
  const held = form();
  const { rerender } = render(<AuditFilters form={held} />);
  expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  await user.type(screen.getByRole('textbox', { name: 'Action' }), '{Enter}');
  expect(held.submit).toHaveBeenCalledOnce();
  rerender(<AuditFilters form={form({ filtered: true })} />);
  expect(screen.getByRole('button', { name: 'Clear filters' })).toBeVisible();
});

it('holds Apply, with its reason, while a date typed reads as nothing', () => {
  render(<AuditFilters form={form({ blocked: 'Correct or clear the date.' })} />);
  const apply = screen.getByRole('button', { name: 'Apply filters' });
  expect(apply).toBeDisabled();
  expect(apply).toHaveAccessibleDescription('Correct or clear the date.');
});

it('tells the form what a date field cannot read', () => {
  const held = form();
  render(<AuditFilters form={held} />);
  const field = screen.getByLabelText('From');
  Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
  fireEvent.input(field, { target: { value: '' } });
  expect(held.report).toHaveBeenCalledWith(
    'from',
    expect.stringMatching(/complete date and time/u),
  );
});

it('does not submit while a date field holds a half-typed value, even with no event from it', async () => {
  const user = userEvent.setup();
  const held = form();
  render(<AuditFilters form={held} />);
  const field = screen.getByLabelText('From');
  Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
  await user.type(screen.getByRole('textbox', { name: 'Action' }), '{Enter}');
  expect(held.submit).not.toHaveBeenCalled();
  expect(held.report).toHaveBeenCalledWith(
    'from',
    expect.stringMatching(/complete date and time/u),
  );
});

it('puts each problem beside its field', () => {
  render(
    <AuditFilters
      form={form({
        draft: { ...EMPTY_DRAFT, actor_subject_id: 'grace' },
        problems: { actor_subject_id: 'A subject id is a UUID.', to: 'To is before From.' },
      })}
    />,
  );
  expect(screen.getByText('A subject id is a UUID.')).toBeVisible();
  expect(screen.getByText('To is before From.')).toBeVisible();
});

it('passes axe in both themes, clean and with problems', async () => {
  expect(await axeInBothThemes(() => <AuditFilters form={form()} />)).toEqual({
    light: [],
    dark: [],
  });
  expect(
    await axeInBothThemes(() => (
      <AuditFilters
        form={form({
          filtered: true,
          draft: { ...EMPTY_DRAFT, actor_subject_id: 'grace', resource_type: 'client' },
          problems: { actor_subject_id: 'A subject id is a UUID.' },
        })}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
