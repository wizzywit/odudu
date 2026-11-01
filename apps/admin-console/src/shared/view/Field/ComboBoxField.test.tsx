import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ComboBoxField, type ComboOption } from '#/shared/view/Field/ComboBoxField';
import { OwnDataFields, ReadOnlyFields } from '#/shared/view/Field/Field';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const ZONES: readonly ComboOption[] = [
  { id: 'Africa/Lagos', label: 'Africa/Lagos', detail: 'UTC+01:00' },
  { id: 'Europe/Berlin', label: 'Europe/Berlin', detail: 'UTC+01:00' },
  { id: 'Asia/Tokyo', label: 'Asia/Tokyo', detail: 'UTC+09:00' },
];

function Controlled({
  custom = false,
  start = '',
  matchIds = true,
}: {
  custom?: boolean;
  start?: string;
  matchIds?: boolean;
}) {
  const [value, setValue] = useState(start);
  return (
    <>
      <ComboBoxField
        label="Time zone"
        options={ZONES}
        value={value}
        onChange={setValue}
        allowsCustomValue={custom}
        matchIds={matchIds}
        autoComplete="off"
      />
      <output aria-label="Stored">{value}</output>
      <button
        type="button"
        onClick={() => {
          setValue('Asia/Tokyo');
        }}
      >
        Reset
      </button>
    </>
  );
}

function ClearedOnEnter() {
  const [value, setValue] = useState('');
  return (
    <div
      role="group"
      aria-label="Adds"
      onKeyDown={(event) => {
        if (event.key === 'Enter') setValue('');
      }}
    >
      <ComboBoxField
        label="Time zone"
        options={ZONES}
        value={value}
        onChange={setValue}
        allowsCustomValue
        autoComplete="off"
      />
    </div>
  );
}

describe('ComboBoxField', () => {
  it('closes its list when the value is cleared from outside while it has focus', async () => {
    const user = userEvent.setup();
    render(<ClearedOnEnter />);
    const box = screen.getByRole('combobox', { name: 'Time zone' });
    await user.type(box, 'Asia');
    expect(await screen.findAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });
    expect(box).toHaveValue('');
  });

  it('narrows the list as you type, and stores the chosen option', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole('combobox', { name: 'Time zone' });
    await user.type(box, 'tok');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Asia/TokyoUTC+09:00']);
    await user.click(screen.getByRole('option', { name: 'Asia/Tokyo' }));
    expect(screen.getByLabelText('Stored')).toHaveTextContent('Asia/Tokyo');
    expect(box).toHaveValue('Asia/Tokyo');
  });

  it('matches what an option shows beside its label', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('combobox', { name: 'Time zone' }), '+01');
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Africa/LagosUTC+01:00',
      'Europe/BerlinUTC+01:00',
    ]);
  });

  it('keeps text that names no option when a custom value is allowed', async () => {
    const user = userEvent.setup();
    render(<Controlled custom />);
    await user.type(screen.getByRole('combobox', { name: 'Time zone' }), 'Asia/Calcutta');
    expect(screen.getByLabelText('Stored')).toHaveTextContent('Asia/Calcutta');
  });

  it('shows a value changed from outside', async () => {
    const user = userEvent.setup();
    render(<Controlled start="Africa/Lagos" />);
    const box = screen.getByRole('combobox', { name: 'Time zone' });
    expect(box).toHaveValue('Africa/Lagos');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(box).toHaveValue('Asia/Tokyo');
  });

  it('opens its whole list from the button, by keyboard alone', async () => {
    const user = userEvent.setup();
    render(<Controlled start="Africa/Lagos" />);
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(await screen.findAllByRole('option')).toHaveLength(3);
  });

  it('carries the autocomplete token it is given', () => {
    const onChange = vi.fn();
    render(
      <OwnDataFields when>
        <ComboBoxField
          label="Country"
          options={[]}
          value=""
          onChange={onChange}
          autoComplete="country-name"
        />
      </OwnDataFields>,
    );
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveAttribute(
      'autocomplete',
      'country-name',
    );
  });

  it('shows its value as text on a page that cannot change it', () => {
    render(
      <ReadOnlyFields when>
        <ComboBoxField label="Time zone" options={ZONES} value="Asia/Tokyo" onChange={vi.fn()} />
      </ReadOnlyFields>,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Asia/Tokyo')).toBeInTheDocument();
  });

  it('closes its list on a whole value that names an option, as a paste or autofill gives', async () => {
    const user = userEvent.setup();
    render(<Controlled custom />);
    const box = screen.getByRole('combobox', { name: 'Time zone' });
    await user.click(box);
    await user.paste('Asia/Tokyo');
    expect(screen.getByLabelText('Stored')).toHaveTextContent('Asia/Tokyo');
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Reset' })).toBeVisible();
  });

  it('commits what was typed when it loses focus', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole('combobox', { name: 'Time zone' });
    await user.type(box, 'asia/tokyo');
    await user.tab();
    expect(screen.getByLabelText('Stored')).toHaveTextContent('Asia/Tokyo');
    expect(box).toHaveValue('Asia/Tokyo');
  });

  it('does not take text for an option’s id when told the ids are not what people type', async () => {
    const user = userEvent.setup();
    function Country() {
      const [value, setValue] = useState('');
      return (
        <>
          <ComboBoxField
            label="Country"
            options={[{ id: 'DE', label: 'Germany' }]}
            value={value}
            onChange={setValue}
            allowsCustomValue
            matchIds={false}
          />
          <output aria-label="Stored">{value}</output>
        </>
      );
    }
    render(<Country />);
    await user.type(screen.getByRole('combobox', { name: 'Country' }), 'de');
    await user.tab();
    expect(screen.getByLabelText('Stored')).toHaveTextContent(/^de$/u);
  });

  it('passes axe in both themes with its list open', async () => {
    const user = userEvent.setup();
    expect(
      await axeInBothThemes(
        () => <ComboBoxField label="Time zone" options={ZONES} value="" onChange={vi.fn()} />,
        async () => {
          await user.click(screen.getByRole('button', { name: /^Show Time zone options/u }));
          await screen.findByRole('listbox');
        },
        // React Aria's ariaHideOutside hides the page while the list is open;
        // focus cannot reach it then, since leaving the input closes the list.
        { disable: ['aria-hidden-focus'] },
      ),
    ).toEqual({ light: [], dark: [] });
  });

  it('draws at most `limit` options, however many there are, and narrows within them', async () => {
    const user = userEvent.setup();
    const many: readonly ComboOption[] = Array.from({ length: 400 }, (_, n) => ({
      id: `key.${String(n)}`,
      label: `key.${String(n)}`,
      detail: n === 399 ? 'the last one' : 'text',
    }));
    render(<ComboBoxField label="Key" options={many} value="" onChange={vi.fn()} limit={25} />);
    await user.click(screen.getByRole('button', { name: /^Show Key options/u }));
    expect(await screen.findAllByRole('option')).toHaveLength(25);
    await user.type(screen.getByRole('combobox', { name: 'Key' }), 'last one');
    const found = await screen.findAllByRole('option');
    expect(found.map((o) => o.textContent)).toEqual(['key.399the last one']);
  });

  it('finds a word past what is drawn of a long detail, and draws only the start of it', async () => {
    const user = userEvent.setup();
    const long: readonly ComboOption[] = [
      { id: 'a', label: 'a', detail: `${'words '.repeat(30)}needle` },
      { id: 'b', label: 'b', detail: 'short' },
    ];
    render(<ComboBoxField label="Key" options={long} value="" onChange={vi.fn()} limit={10} />);
    await user.type(screen.getByRole('combobox', { name: 'Key' }), 'needle');
    const found = await screen.findAllByRole('option');
    expect(found).toHaveLength(1);
    expect(found[0]?.textContent).toMatch(/^a.*…$/u);
    expect(found[0]?.textContent).not.toContain('needle');
  });

  it('offers the whole bounded list again after a choice', async () => {
    const user = userEvent.setup();
    const many: readonly ComboOption[] = Array.from({ length: 60 }, (_, n) => ({
      id: `k${String(n)}`,
      label: `k${String(n)}`,
    }));
    function Holder() {
      const [value, setValue] = useState('');
      return (
        <ComboBoxField label="Key" options={many} value={value} onChange={setValue} limit={10} />
      );
    }
    render(<Holder />);
    const input = screen.getByRole('combobox', { name: 'Key' });
    await user.type(input, 'k5');
    await user.click(await screen.findByRole('option', { name: 'k5' }));
    await user.click(screen.getByRole('button', { name: /^Show Key options/u }));
    expect(await screen.findAllByRole('option')).toHaveLength(10);
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <ComboBoxField
          label="Time zone"
          description="Where the subject is."
          options={ZONES}
          value="Africa/Lagos"
          onChange={vi.fn()}
          error="Not a zone."
          changed
        />
      )),
    ).toEqual({ light: [], dark: [] });
  });
});
