import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('names the capability that is missing', () => {
  render(<CapabilityNote capability="manage-clients" />);
  const note = screen.getByRole('note');
  expect(note).toHaveTextContent('This needs the manage-clients capability.');
  expect(screen.getByText('manage-clients').tagName).toBe('CODE');
});

it('says what the capability would allow', () => {
  render(<CapabilityNote capability="manage-clients">Changing a client</CapabilityNote>);
  expect(screen.getByRole('note')).toHaveTextContent(
    'Changing a client needs the manage-clients capability.',
  );
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <CapabilityNote capability="manage-clients" />)).toEqual({
    light: [],
    dark: [],
  });
});
