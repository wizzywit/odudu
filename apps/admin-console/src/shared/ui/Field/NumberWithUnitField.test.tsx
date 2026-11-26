import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyFields } from '#/shared/ui/Field/Field';
import { NumberWithUnitField } from '#/shared/ui/Field/NumberWithUnitField';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

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

  it('reads a cleared field as a dash, not as NaN', () => {
    render(<NumberWithUnitField label="Uses" unit="uses" value={Number.NaN} onChange={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Uses' });
    expect(describedBy(input)).not.toContain('NaN');
    expect(describedBy(input)).toContain('—');
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

describe('NumberWithUnitField with a unit picker', () => {
  function Seconds({ start, echo = false }: { start: number; echo?: boolean }) {
    const [value, setValue] = useState(start);
    return (
      <>
        <NumberWithUnitField
          label="Idle"
          unit="seconds"
          picker
          echo={echo}
          minValue={60}
          maxValue={86_400}
          rangeMessage="Allowed: 1 minute to 1 day."
          value={value}
          onChange={setValue}
        />
        <output aria-label="seconds">{String(value)}</output>
      </>
    );
  }

  const unitButton = () => screen.getByRole('button', { name: /Idle, unit/u });

  it('shows the unit that fits and no reading beneath it', () => {
    render(<Seconds start={1800} />);
    expect(screen.getByRole('textbox', { name: 'Idle' })).toHaveValue('30');
    expect(unitButton()).toHaveTextContent('min');
    expect(screen.queryByText(/1800 s/u)).toBeNull();
  });

  it('is the design-system listbox, not the browser select', async () => {
    const user = userEvent.setup();
    render(<Seconds start={1800} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    await user.click(unitButton());
    expect(screen.getByRole('listbox', { name: 'Idle, unit' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('s'),
      expect.stringContaining('min'),
      expect.stringContaining('h'),
      expect.stringContaining('d'),
    ]);
  });

  it('keeps the seconds the same value in whatever unit it is typed', async () => {
    const user = userEvent.setup();
    render(<Seconds start={7200} />);
    expect(unitButton()).toHaveTextContent('h');
    await user.click(unitButton());
    await user.click(screen.getByRole('option', { name: 'min' }));
    expect(unitButton()).toHaveTextContent('min');
    expect(screen.getByLabelText('seconds')).toHaveTextContent('7200');
    const input = screen.getByRole('textbox', { name: 'Idle' });
    await user.clear(input);
    await user.type(input, '180');
    await user.tab();
    expect(screen.getByLabelText('seconds')).toHaveTextContent('10800');
  });

  it('is picked from the keyboard', async () => {
    const user = userEvent.setup();
    render(<Seconds start={7200} />);
    unitButton().focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(unitButton()).toHaveTextContent('min');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(unitButton()).toHaveTextContent('min');
  });

  it('keeps the unit a value is typed in, even when another would fit it', async () => {
    const user = userEvent.setup();
    render(<Seconds start={1800} />);
    const input = screen.getByRole('textbox', { name: 'Idle' });
    await user.clear(input);
    await user.type(input, '60');
    await user.tab();
    expect(screen.getByLabelText('seconds')).toHaveTextContent('3600');
    expect(input).toHaveValue('60');
    expect(unitButton()).toHaveTextContent('min');
  });

  it('offers only the units the value is a whole count of, so looking changes nothing', async () => {
    const user = userEvent.setup();
    render(<Seconds start={5400} />);
    await user.click(unitButton());
    expect(screen.getByRole('option', { name: 'h' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'min' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByLabelText('seconds')).toHaveTextContent('5400');
  });

  it('flags a value outside the range with the message it was given', () => {
    render(<Seconds start={30} />);
    expect(screen.getByRole('textbox', { name: 'Idle' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Allowed: 1 minute to 1 day.')).toBeVisible();
  });

  it('passes axe in both themes', async () => {
    expect(await axeInBothThemes(() => <Seconds start={1800} />)).toEqual({
      light: [],
      dark: [],
    });
  });
});

describe('NumberWithUnitField without the reading', () => {
  it('leaves the value unechoed beneath a count', () => {
    render(
      <NumberWithUnitField label="Uses" unit="uses" echo={false} value={25} onChange={vi.fn()} />,
    );
    expect(screen.queryByText('25 uses')).toBeNull();
    expect(screen.getByText('uses', { selector: '[data-unit]' })).toBeInTheDocument();
  });
});
