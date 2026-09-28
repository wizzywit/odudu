import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  KeyValueField,
  NumberWithUnitField,
  SelectField,
  TextField,
  ToggleField,
  UrlListField,
  type KeyValuePair,
} from '#/shared/view/Field.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function describedBy(element: HTMLElement): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/u)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ');
}

describe('TextField', () => {
  it('is a labelled textbox that reports each change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Name" value="" onChange={onChange} />);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('puts the error under the field and ties it to the input', () => {
    render(
      <TextField
        label="Name"
        description="Shown on the consent page."
        value=""
        onChange={vi.fn()}
        error="A name is required."
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(input)).toContain('A name is required.');
    expect(describedBy(input)).toContain('Shown on the consent page.');
    const error = screen.getByText('A name is required.');
    expect(input.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is not invalid without an error', () => {
    render(<TextField label="Name" value="" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid');
  });

  it('marks a changed field in words', () => {
    render(<TextField label="Name" value="Billing" onChange={vi.fn()} changed />);
    expect(screen.getByText('Changed')).toBeInTheDocument();
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <TextField label="Name" value="Billing" onChange={vi.fn()} error="Too long." changed />
      )),
    ).toEqual({ light: [], dark: [] });
  });
});

describe('NumberWithUnitField', () => {
  it('shows the unit and the human reading of seconds', () => {
    render(
      <NumberWithUnitField
        label="Session lifetime"
        unit="seconds"
        value={1209600}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Session lifetime' });
    expect(input).toHaveValue('1209600');
    expect(describedBy(input)).toContain('1209600 s · 14 days');
    expect(screen.getByText('s', { selector: '[data-unit]' })).toBeInTheDocument();
  });

  it('reports a typed number and reads it back', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = useState(60);
      return (
        <NumberWithUnitField label="Lifetime" unit="seconds" value={value} onChange={setValue} />
      );
    }
    render(<Controlled />);
    const input = screen.getByRole('textbox', { name: 'Lifetime' });
    await user.clear(input);
    await user.type(input, '3600');
    await user.tab();
    expect(screen.getByText('3600 s · 1 hour')).toBeInTheDocument();
  });

  it('shows another unit as it is, with its error', () => {
    render(
      <NumberWithUnitField
        label="Lockout threshold"
        unit="attempts"
        value={5}
        onChange={vi.fn()}
        error="Must be at least 1."
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Lockout threshold' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(input)).toContain('Must be at least 1.');
    expect(screen.getByText('attempts', { selector: '[data-unit]' })).toBeInTheDocument();
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <NumberWithUnitField label="Lifetime" unit="seconds" value={300} onChange={vi.fn()} />
      )),
    ).toEqual({ light: [], dark: [] });
  });
});

describe('SelectField', () => {
  const OPTIONS = [
    { id: 'required', label: 'Required' },
    { id: 'optional', label: 'Optional' },
    { id: 'disabled', label: 'Disabled' },
  ];

  it('opens a listbox and reports the choice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField label="Requirement" options={OPTIONS} value="required" onChange={onChange} />,
    );
    const trigger = screen.getByRole('button', { name: /Requirement/u });
    expect(trigger).toHaveTextContent('Required');
    await user.click(trigger);
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Optional' }));
    expect(onChange).toHaveBeenCalledWith('optional');
  });

  it('ties its error to the trigger', () => {
    render(
      <SelectField
        label="Requirement"
        options={OPTIONS}
        value="required"
        onChange={vi.fn()}
        error="The last step cannot be disabled."
      />,
    );
    expect(describedBy(screen.getByRole('button', { name: /Requirement/u }))).toContain(
      'The last step cannot be disabled.',
    );
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <SelectField label="Requirement" options={OPTIONS} value="optional" onChange={vi.fn()} />
      )),
    ).toEqual({ light: [], dark: [] });
  });
});

describe('ToggleField', () => {
  it('is a switch that says its state in words', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToggleField label="Remember me" value={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Remember me' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Off')).toBeInTheDocument();
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('ties its description and error to the switch', () => {
    render(
      <ToggleField
        label="Email verification"
        description="New accounts confirm their address."
        value
        onChange={vi.fn()}
        error="No SMTP server is configured."
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'Email verification' });
    expect(describedBy(toggle)).toContain('New accounts confirm their address.');
    expect(describedBy(toggle)).toContain('No SMTP server is configured.');
    expect(toggle).toHaveAttribute('aria-invalid', 'true');
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <ToggleField label="Remember me" value onChange={vi.fn()} error="Not allowed." />
      )),
    ).toEqual({ light: [], dark: [] });
  });
});

function Urls({
  initial,
  error,
}: {
  readonly initial: readonly string[];
  readonly error?: string;
}) {
  const [urls, setUrls] = useState(initial);
  return (
    <UrlListField
      label="Redirect URIs"
      itemLabel="Redirect URI"
      value={urls}
      onChange={setUrls}
      itemErrors={[undefined, 'Must be an absolute https URL.']}
      {...(error === undefined ? {} : { error })}
    />
  );
}

describe('UrlListField', () => {
  it('is a group of labelled rows, each with a visible remove control', async () => {
    const user = userEvent.setup();
    render(<Urls initial={['https://a.example.com/cb', 'http://b.example.com/cb']} />);
    const group = screen.getByRole('group', { name: 'Redirect URIs' });
    expect(within(group).getByRole('textbox', { name: 'Redirect URI 1' })).toHaveValue(
      'https://a.example.com/cb',
    );
    await user.click(
      within(group).getByRole('button', {
        name: 'Remove redirect URI 1, https://a.example.com/cb',
      }),
    );
    expect(within(group).getAllByRole('textbox')).toHaveLength(1);
    expect(within(group).getByRole('button', { name: 'Add redirect URI' })).toHaveFocus();
    expect(within(group).getByRole('textbox', { name: 'Redirect URI 1' })).toHaveValue(
      'http://b.example.com/cb',
    );
  });

  it('adds a row and moves focus into it', async () => {
    const user = userEvent.setup();
    render(<Urls initial={['https://a.example.com/cb']} />);
    await user.click(screen.getByRole('button', { name: 'Add redirect URI' }));
    const added = screen.getByRole('textbox', { name: 'Redirect URI 2' });
    expect(added).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Remove redirect URI 2, empty' }),
    ).toBeInTheDocument();
    await user.type(added, 'https://c.example.com/cb');
    expect(added).toHaveValue('https://c.example.com/cb');
  });

  it('keeps a row its own element when an earlier row is removed', async () => {
    const user = userEvent.setup();
    render(<Urls initial={['https://a.example.com/cb', 'https://b.example.com/cb']} />);
    const second = screen.getByRole('textbox', { name: 'Redirect URI 2' });
    await user.click(screen.getByRole('button', { name: /^Remove redirect URI 1,/u }));
    expect(screen.getByRole('textbox', { name: 'Redirect URI 1' })).toBe(second);
  });

  it('ties an error to the row it names and the field error to the group', () => {
    render(
      <Urls
        initial={['https://a.example.com/cb', 'http://b.example.com/cb']}
        error="At least one redirect URI is required."
      />,
    );
    const second = screen.getByRole('textbox', { name: 'Redirect URI 2' });
    expect(second).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(second)).toContain('Must be an absolute https URL.');
    expect(screen.getByRole('textbox', { name: 'Redirect URI 1' })).not.toHaveAttribute(
      'aria-invalid',
    );
    expect(describedBy(screen.getByRole('group', { name: 'Redirect URIs' }))).toContain(
      'At least one redirect URI is required.',
    );
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <Urls initial={['https://a.example.com/cb', 'http://b.example.com/cb']} error="Bad." />
      )),
    ).toEqual({ light: [], dark: [] });
  });
});

function Pairs({ initial }: { readonly initial: readonly KeyValuePair[] }) {
  const [pairs, setPairs] = useState(initial);
  return (
    <KeyValueField
      label="Claim values"
      keyLabel="Claim"
      valueLabel="Value"
      value={pairs}
      onChange={setPairs}
      error="Claim names must be unique."
    />
  );
}

describe('KeyValueField', () => {
  it('edits, adds and removes pairs by visible, labelled controls', async () => {
    const user = userEvent.setup();
    render(<Pairs initial={[{ key: 'tier', value: 'gold' }]} />);
    const group = screen.getByRole('group', { name: 'Claim values' });
    await user.type(within(group).getByRole('textbox', { name: 'Value 1' }), '-plus');
    expect(within(group).getByRole('textbox', { name: 'Value 1' })).toHaveValue('gold-plus');
    await user.click(within(group).getByRole('button', { name: 'Add claim' }));
    expect(within(group).getByRole('textbox', { name: 'Claim 2' })).toHaveFocus();
    await user.click(within(group).getByRole('button', { name: 'Remove claim 1, tier' }));
    expect(within(group).getByRole('button', { name: 'Add claim' })).toHaveFocus();
    expect(within(group).getAllByRole('textbox')).toHaveLength(2);
    expect(within(group).getByRole('textbox', { name: 'Claim 1' })).toHaveValue('');
    expect(describedBy(group)).toContain('Claim names must be unique.');
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => <Pairs initial={[{ key: 'tier', value: 'gold' }]} />),
    ).toEqual({
      light: [],
      dark: [],
    });
  });
});
