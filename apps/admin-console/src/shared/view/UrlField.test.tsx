import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyFields } from '#/shared/view/Field.tsx';
import { PictureField, UrlField } from '#/shared/view/UrlField.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function Controlled() {
  const [value, setValue] = useState('');
  return <UrlField label="Website" value={value} onChange={setValue} />;
}

describe('UrlField', () => {
  it('says what is wrong as it is typed, not before the scheme is finished', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole('textbox', { name: 'Website' });
    expect(box).toHaveAttribute('autocomplete', 'url');
    expect(box).toHaveAttribute('type', 'url');
    await user.type(box, 'https:');
    expect(box).not.toHaveAttribute('aria-invalid');
    await user.clear(box);
    await user.type(box, 'example.com');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription(/Start it with https:\/\/ or http:\/\//u);
  });

  it('puts the server’s error before its own', () => {
    render(<UrlField label="Website" value="example.com" onChange={vi.fn()} error="Refused." />);
    expect(screen.getByRole('textbox', { name: 'Website' })).toHaveAccessibleDescription(
      /Refused\./u,
    );
  });
});

describe('PictureField', () => {
  it('previews a picture the console’s own origin serves', () => {
    const own = `${window.location.origin}/avatar.png`;
    render(<PictureField label="Picture" value={own} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Picture' })).toHaveAttribute(
      'autocomplete',
      'photo',
    );
    expect(screen.getByRole('img', { name: 'The picture at this address' })).toHaveAttribute(
      'src',
      own,
    );
  });

  it('names a picture on another site instead of loading what the policy would block', () => {
    render(<PictureField label="Picture" value="https://cdn.example/ada.png" onChange={vi.fn()} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Picture' })).toHaveAccessibleDescription(
      /loads images from its own address only/u,
    );
    const link = screen.getByRole('link', { name: 'Open the picture in a new tab' });
    expect(link).toHaveAttribute('href', 'https://cdn.example/ada.png');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('reads as text on a page that cannot change it', () => {
    render(
      <ReadOnlyFields when>
        <PictureField label="Picture" value="https://cdn.example/ada.png" onChange={vi.fn()} />
      </ReadOnlyFields>,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('https://cdn.example/ada.png')).toBeInTheDocument();
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <>
          <UrlField label="Website" value="example.com" onChange={vi.fn()} changed />
          <PictureField label="Picture" value="https://cdn.example/ada.png" onChange={vi.fn()} />
          <PictureField
            label="Own picture"
            value={`${window.location.origin}/a.png`}
            onChange={vi.fn()}
          />
        </>
      )),
    ).toEqual({ light: [], dark: [] });
  });
});
