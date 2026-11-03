import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DescriptionField } from '#/shared/ui/DescriptionField';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function save(overrides: Partial<Parameters<typeof DescriptionField>[0]['save']> = {}) {
  return {
    values: { description: 'Reads the books' },
    fieldErrors: {},
    changed: [] as string[],
    edit: vi.fn(),
    ...overrides,
  };
}

it('shows the description under its rule, counted against the limit when it has one', () => {
  render(<DescriptionField save={save()} rule="Leave it empty for none." limit={100} />);
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Reads the books');
  expect(screen.getByText('Leave it empty for none.')).toBeVisible();
  expect(screen.getByText('15 of 100 characters.')).toBeVisible();
});

it('counts nothing where it has no limit', () => {
  render(<DescriptionField save={save()} rule="Leave it empty for none." />);
  expect(screen.queryByText(/characters\./u)).toBeNull();
});

it('hands each edit to the section it belongs to', async () => {
  const user = userEvent.setup();
  const own = save({ values: { description: '' } });
  render(<DescriptionField save={own} rule="Leave it empty for none." />);
  await user.type(screen.getByRole('textbox', { name: 'Description' }), 'x');
  expect(own.edit).toHaveBeenCalledWith('description', 'x');
});

it('says what the server refused, and marks a field changed since it was read', () => {
  render(
    <DescriptionField
      save={save({ fieldErrors: { description: 'Too long' }, changed: ['description'] })}
      rule="Leave it empty for none."
    />,
  );
  expect(screen.getByText('Too long')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});

it('has no accessibility violations in either theme', async () => {
  expect(
    await axeInBothThemes(() => (
      <DescriptionField save={save()} rule="Leave it empty for none." limit={100} />
    )),
  ).toEqual({ light: [], dark: [] });
});
