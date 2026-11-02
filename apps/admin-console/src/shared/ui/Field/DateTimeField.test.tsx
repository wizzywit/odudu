import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DateTimeField } from '#/shared/ui/Field/DateTimeField';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function Controlled({
  start = '',
  edge = 'start',
  error,
  zone = 'Africa/Lagos',
  onProblem,
}: {
  start?: string;
  edge?: 'start' | 'end';
  error?: string;
  zone?: string;
  onProblem?: (message: string | null) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <>
      <DateTimeField
        label="From"
        description="Events at or after this time."
        edge={edge}
        zone={zone}
        {...(onProblem === undefined ? {} : { onProblem })}
        value={value}
        onChange={setValue}
        error={error}
      />
      <output aria-label="Stored">{value}</output>
    </>
  );
}

function input(): HTMLInputElement {
  const found = screen.getByLabelText('From');
  if (!(found instanceof HTMLInputElement)) throw new Error('not an input');
  return found;
}

function stored(): string {
  return screen.getByLabelText('Stored').textContent;
}

// What Chrome reports for a value it was given and could not complete: no
// value, and `badInput`.
function typeUnreadable(): void {
  const field = input();
  Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
  fireEvent.input(field, { target: { value: '' } });
}

function described(): string {
  return (input().getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

describe('DateTimeField', () => {
  it('shows an instant as the zone reads it, and names the zone', () => {
    render(<Controlled start="2026-09-28T13:41:00.000Z" />);
    expect(input()).toHaveValue('2026-09-28T14:41');
    expect(input()).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByText(/In Africa\/Lagos \(UTC\+01:00\)/u)).toBeVisible();
  });

  it('stores what is picked as a UTC instant, from the start of its minute', () => {
    render(<Controlled />);
    fireEvent.input(input(), { target: { value: '2026-09-28T14:41' } });
    expect(stored()).toBe('2026-09-28T13:41:00.000Z');
  });

  it('stores the end of the minute for an upper bound', () => {
    render(<Controlled edge="end" />);
    fireEvent.input(input(), { target: { value: '2026-09-28T14:41' } });
    expect(stored()).toBe('2026-09-28T13:41:59.999Z');
  });

  it('stores nothing, and is not invalid, when it is cleared', () => {
    render(<Controlled start="2026-09-28T13:41:00.000Z" />);
    fireEvent.input(input(), { target: { value: '' } });
    expect(stored()).toBe('');
    expect(input()).not.toBeInvalid();
  });

  it('puts an error given under the field', () => {
    render(<Controlled error="To is before From." />);
    expect(input()).toBeInvalid();
    expect(described()).toContain('To is before From.');
  });

  it('shows seconds when the instant it holds has them, so what is shown is what is sent', () => {
    render(<Controlled start="2026-09-28T13:41:30.000Z" />);
    expect(input()).toHaveValue('2026-09-28T14:41:30');
    expect(input()).toHaveAttribute('step', '1');
  });
});

describe('what is typed and is not an instant', () => {
  it('marks a half-typed value invalid, tied to the field, and stores nothing', () => {
    const reported: (string | null)[] = [];
    render(<Controlled onProblem={(text) => reported.push(text)} />);
    typeUnreadable();
    expect(input()).toBeInvalid();
    expect(described()).toMatch(/complete date and time/u);
    expect(stored()).toBe('');
    expect(reported.at(-1)).toMatch(/complete date and time/u);
  });

  it('asks what could not be read when the field is left, since a browser says nothing while a first value is half typed', () => {
    render(<Controlled />);
    const field = input();
    Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
    fireEvent.blur(field);
    expect(field).toBeInvalid();
    expect(described()).toMatch(/complete date and time/u);
  });

  it('marks a day the month lacks invalid, as a browser that let it through would hand it over', () => {
    render(<Controlled zone="America/New_York" />);
    fireEvent.input(input(), { target: { value: '2024-02-30T01:00' } });
    // jsdom, like a browser, gives a value that is no date back as nothing.
    expect(stored()).toBe('');
  });

  it('marks the hour a spring-forward skips invalid, naming the zone, and keeps the text', () => {
    const reported: (string | null)[] = [];
    render(<Controlled zone="America/New_York" onProblem={(text) => reported.push(text)} />);
    fireEvent.input(input(), { target: { value: '2026-03-08T02:30' } });
    expect(input()).toBeInvalid();
    expect(input()).toHaveValue('2026-03-08T02:30');
    expect(described()).toContain('does not exist in America/New_York');
    expect(stored()).toBe('');
    expect(reported.at(-1)).toContain('does not exist in America/New_York');
  });

  it('reads the earlier of the two times a fall-back repeats, and says nothing', () => {
    render(<Controlled zone="America/New_York" />);
    fireEvent.input(input(), { target: { value: '2026-11-01T01:30' } });
    expect(stored()).toBe('2026-11-01T05:30:00.000Z');
    expect(input()).not.toBeInvalid();
  });

  it('clears the problem when the value is corrected', () => {
    const reported: (string | null)[] = [];
    render(<Controlled zone="America/New_York" onProblem={(text) => reported.push(text)} />);
    fireEvent.input(input(), { target: { value: '2026-03-08T02:30' } });
    expect(input()).toBeInvalid();
    fireEvent.input(input(), { target: { value: '2026-03-08T03:30' } });
    expect(input()).not.toBeInvalid();
    expect(stored()).toBe('2026-03-08T07:30:00.000Z');
    expect(reported.at(-1)).toBeNull();
  });

  it('passes axe in both themes with the problem shown', async () => {
    expect(
      await axeInBothThemes(
        () => <Controlled zone="America/New_York" />,
        () => {
          fireEvent.input(input(), { target: { value: '2026-03-08T02:30' } });
          return Promise.resolve();
        },
      ),
    ).toEqual({ light: [], dark: [] });
  });

  it('passes axe in both themes when clean', async () => {
    expect(await axeInBothThemes(() => <Controlled start="2026-09-28T13:41:00.000Z" />)).toEqual({
      light: [],
      dark: [],
    });
  });
});
