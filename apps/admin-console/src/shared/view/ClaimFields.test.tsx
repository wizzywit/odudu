import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentType } from 'react';
import { I18nProvider } from 'react-aria-components';
import { describe, expect, it, vi } from 'vitest';
import {
  CountryField,
  GenderField,
  LocaleField,
  TimeZoneField,
} from '#/shared/view/ClaimFields.tsx';
import { ReadOnlyFields } from '#/shared/view/Field.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function Controlled({
  Field,
  label,
  start = '',
  locale = 'en-GB',
}: {
  Field: ComponentType<FieldProps>;
  label: string;
  start?: string;
  locale?: string;
}) {
  const [value, setValue] = useState(start);
  return (
    <I18nProvider locale={locale}>
      <Field label={label} value={value} onChange={setValue} />
      <output aria-label="Stored">{value}</output>
    </I18nProvider>
  );
}

function stored(): string {
  return screen.getByLabelText('Stored').textContent;
}

describe('CountryField', () => {
  it('lists names in the reader’s language and stores the English one', async () => {
    const user = userEvent.setup();
    render(<Controlled Field={CountryField} label="Land" locale="de" />);
    const box = screen.getByRole('combobox', { name: 'Land' });
    expect(box).toHaveAttribute('autocomplete', 'country-name');
    await user.type(box, 'Deutsch');
    await user.click(await screen.findByRole('option', { name: 'Deutschland' }));
    expect(stored()).toBe('Germany');
    expect(box).toHaveValue('Deutschland');
  });

  it('shows a stored English name in the reader’s language, and keeps any other as it is', () => {
    const { unmount } = render(
      <Controlled Field={CountryField} label="Land" locale="de" start="Germany" />,
    );
    expect(screen.getByRole('combobox', { name: 'Land' })).toHaveValue('Deutschland');
    unmount();
    render(<Controlled Field={CountryField} label="Country" start="Wakanda" />);
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveValue('Wakanda');
  });
});

describe('TimeZoneField', () => {
  it('offers each zone with its offset, and stores its name', async () => {
    const user = userEvent.setup();
    render(<Controlled Field={TimeZoneField} label="Time zone" />);
    await user.type(screen.getByRole('combobox', { name: 'Time zone' }), 'Lagos');
    const lagos = await screen.findByRole('option', { name: 'Africa/Lagos' });
    expect(lagos).toHaveAccessibleDescription(/^UTC[+-]\d\d:\d\d$/u);
    await user.click(lagos);
    expect(stored()).toBe('Africa/Lagos');
  });

  it('refuses a name that is no zone in the shape the server takes', async () => {
    const user = userEvent.setup();
    render(<Controlled Field={TimeZoneField} label="Time zone" />);
    await user.type(screen.getByRole('combobox', { name: 'Time zone' }), '+1');
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveAccessibleDescription(
      /Choose a zone from the list, such as Africa\/Lagos\./u,
    );
  });
});

describe('LocaleField', () => {
  it('shows each locale by name and stores its BCP 47 tag', async () => {
    const user = userEvent.setup();
    render(<Controlled Field={LocaleField} label="Locale" locale="en" />);
    const box = screen.getByRole('combobox', { name: 'Locale' });
    expect(box).toHaveAttribute('autocomplete', 'language');
    await user.type(box, 'English (Nig');
    await user.click(await screen.findByRole('option', { name: 'English (Nigeria)' }));
    expect(stored()).toBe('en-NG');
  });

  it('takes a typed tag the list does not hold', async () => {
    const user = userEvent.setup();
    render(<Controlled Field={LocaleField} label="Locale" locale="en" />);
    await user.type(screen.getByRole('combobox', { name: 'Locale' }), 'ff-SN');
    expect(stored()).toBe('ff-SN');
  });

  it('says what it takes when the text is no tag', async () => {
    const user = userEvent.setup();
    render(<Controlled Field={LocaleField} label="Locale" locale="en" />);
    await user.type(screen.getByRole('combobox', { name: 'Locale' }), 'Klingon');
    expect(screen.getByRole('combobox', { name: 'Locale' })).toHaveAccessibleDescription(
      /Choose a language, or type a tag such as en-NG\./u,
    );
  });
});

describe('GenderField', () => {
  it('stores the values OIDC names, and any other the subject gives', async () => {
    const user = userEvent.setup();
    render(<Controlled Field={GenderField} label="Gender" />);
    await user.click(screen.getByRole('button', { name: /Gender/u }));
    await user.click(await screen.findByRole('option', { name: 'Female' }));
    expect(stored()).toBe('female');
    await user.click(screen.getByRole('button', { name: /Gender/u }));
    await user.click(await screen.findByRole('option', { name: 'In their own words' }));
    const words = screen.getByRole('textbox', { name: 'Their words' });
    expect(words).toHaveAttribute('autocomplete', 'sex');
    await user.type(words, 'non-binary');
    expect(stored()).toBe('non-binary');
  });

  it('opens a stored free-text gender in its own words', () => {
    render(<Controlled Field={GenderField} label="Gender" start="non-binary" />);
    expect(screen.getByRole('textbox', { name: 'Their words' })).toHaveValue('non-binary');
  });
});

describe('read-only', () => {
  it('shows each as text', () => {
    render(
      <I18nProvider locale="en-GB">
        <ReadOnlyFields when>
          <CountryField label="Country" value="Germany" onChange={vi.fn()} />
          <LocaleField label="Locale" value="en-NG" onChange={vi.fn()} />
          <GenderField label="Gender" value="female" onChange={vi.fn()} />
          <TimeZoneField label="Time zone" value="UTC" onChange={vi.fn()} />
        </ReadOnlyFields>
      </I18nProvider>,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Germany')).toBeInTheDocument();
    expect(screen.getByText('English (Nigeria) · en-NG')).toBeInTheDocument();
    expect(screen.getByText('Female')).toBeInTheDocument();
    expect(screen.getByText('UTC · UTC+00:00')).toBeInTheDocument();
  });
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <>
        <CountryField label="Country" value="Nigeria" onChange={vi.fn()} changed />
        <TimeZoneField label="Time zone" value="Africa/Lagos" onChange={vi.fn()} />
        <LocaleField label="Locale" value="xx_yy" onChange={vi.fn()} />
        <GenderField label="Gender" value="non-binary" onChange={vi.fn()} error="Too long." />
      </>
    )),
  ).toEqual({ light: [], dark: [] });
});
