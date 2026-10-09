import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyFields } from '#/shared/view/Field/Field.tsx';
import { NumberWithUnitField } from '#/shared/view/Field/NumberWithUnitField.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function describedBy(element: HTMLElement): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/u)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ');
}

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

describe('NumberWithUnitField on a page that cannot be changed', () => {
  it('shows the number with its reading as text', () => {
    render(
      <ReadOnlyFields when>
        <NumberWithUnitField label="Lifetime" unit="seconds" value={900} onChange={vi.fn()} />
      </ReadOnlyFields>,
    );
    expect(screen.getByText('900 s · 15 minutes')).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
