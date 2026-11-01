import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { ColourField } from '#/features/branding/view/ColourField';

function field(onChange: (value: string) => void = () => undefined, value = '#0a6344') {
  return (
    <ColourField
      label="Light text"
      value={value}
      error={undefined}
      changed={false}
      onChange={onChange}
    />
  );
}

it('types a colour and picks one, each answered as text', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn<(value: string) => void>();
  render(field(onChange, ''));
  await user.type(screen.getByRole('textbox', { name: 'Light text' }), '#');
  expect(onChange).toHaveBeenLastCalledWith('#');
  expect(screen.getByLabelText('Pick light text')).toHaveAttribute('type', 'color');
});

it('shows black in the picker for a colour not finished yet', () => {
  render(field(undefined, '#12'));
  expect(screen.getByLabelText('Pick light text')).toHaveValue('#000000');
});

it('has nothing axe can find in either theme', async () => {
  const found = await axeInBothThemes(() => field());
  expect(found).toEqual({ light: [], dark: [] });
});
