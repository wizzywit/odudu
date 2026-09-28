import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CopyValue } from '#/shared/view/CopyValue.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const ISSUER = 'https://id.example.com/acme';

afterEach(() => {
  vi.restoreAllMocks();
});

it('copies its value and says so', async () => {
  const user = userEvent.setup();
  render(<CopyValue label="issuer" value={ISSUER} />);
  expect(screen.getByText(ISSUER)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Copy issuer' }));
  expect(await navigator.clipboard.readText()).toBe(ISSUER);
  expect(screen.getByRole('status')).toHaveTextContent('Copied issuer');
});

it('says so when the browser refuses the copy', async () => {
  const user = userEvent.setup();
  render(<CopyValue label="issuer" value={ISSUER} />);
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
  await user.click(screen.getByRole('button', { name: 'Copy issuer' }));
  expect(screen.getByRole('status')).toHaveTextContent('Could not copy issuer');
});

it('shortens an id it shows, and copies it whole', async () => {
  const user = userEvent.setup();
  const id = '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e';
  render(<CopyValue label="client id" value={id} short />);
  expect(screen.getByText('0192f7a4…')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Copy client id' }));
  expect(await navigator.clipboard.readText()).toBe(id);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <CopyValue label="issuer" value={ISSUER} />)).toEqual({
    light: [],
    dark: [],
  });
});
