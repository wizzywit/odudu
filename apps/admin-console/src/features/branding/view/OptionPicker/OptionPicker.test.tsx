import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InsertPicker, OptionPicker } from '#/features/branding/view/OptionPicker';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { CodeField } from '#/shared/view/CodeField';
import type { ComboOption } from '#/shared/view/Field';
import type { Read } from '#/shared/service/read';

const OPTIONS: ComboOption[] = [
  { id: 'one', label: 'one', detail: 'First' },
  { id: 'two', label: 'two', detail: 'Second' },
  { id: 'three', label: 'three', detail: 'Third' },
];
const WORDING = { loading: 'Reading.', failed: 'Could not read.' };
const ready: Read<ComboOption[]> = { status: 'ready', data: OPTIONS };

function Picked({
  options = ready,
  limit = 50,
}: {
  options?: Read<ComboOption[]>;
  limit?: number;
}) {
  const [value, setValue] = useState('');
  return (
    <>
      <OptionPicker
        options={options}
        wording={WORDING}
        limit={limit}
        label="Choice"
        description="Pick one."
        value={value}
        onChange={setValue}
      />
      <output aria-label="Picked">{value}</output>
    </>
  );
}

function Editor({ text }: { text?: (id: string) => string }) {
  const [value, setValue] = useState('');
  return (
    <CodeField
      label="Editor"
      language="css"
      value={value}
      onChange={setValue}
      tools={
        <InsertPicker
          options={ready}
          wording={WORDING}
          limit={50}
          label="Insert"
          description="Types it."
          {...(text === undefined ? {} : { text })}
        />
      }
    />
  );
}

describe('OptionPicker', () => {
  it('narrows by the option’s detail and chooses by keyboard', async () => {
    const user = userEvent.setup();
    render(<Picked />);
    await user.type(screen.getByRole('combobox', { name: 'Choice' }), 'Second');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByLabelText('Picked')).toHaveTextContent('two');
  });

  it('draws no more than its limit', async () => {
    const user = userEvent.setup();
    render(<Picked limit={2} />);
    await user.click(screen.getByRole('button', { name: /^Show Choice options/u }));
    expect(await screen.findAllByRole('option')).toHaveLength(2);
  });

  it('says it is loading and unusable, then offers another try when it failed', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Picked options={{ status: 'loading' }} />);
    expect(screen.getByRole('combobox', { name: 'Choice' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Choice' })).toHaveAccessibleDescription(
      /Reading\./u,
    );
    rerender(<Picked options={{ status: 'failed', refused: false, retry }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('has nothing axe can find in either theme', async () => {
    expect(await axeInBothThemes(() => <Picked />)).toEqual({ light: [], dark: [] });
  });
});

describe('InsertPicker', () => {
  it('types the option’s id as it stands unless told how to write it', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.type(screen.getByRole('combobox', { name: 'Insert' }), 'thr');
    await user.click(await screen.findByRole('option', { name: /three/u }));
    expect(screen.getByRole('textbox', { name: 'Editor' })).toHaveValue('three');
  });

  it('types what `text` makes of it', async () => {
    const user = userEvent.setup();
    render(<Editor text={(id) => `[${id}]`} />);
    await user.type(screen.getByRole('combobox', { name: 'Insert' }), 'one');
    await user.click(await screen.findByRole('option', { name: /one/u }));
    expect(screen.getByRole('textbox', { name: 'Editor' })).toHaveValue('[one]');
  });
});
