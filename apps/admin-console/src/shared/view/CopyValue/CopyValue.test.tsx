import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CopyValue } from '#/shared/view/CopyValue/CopyValue.tsx';
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

it('says so when the page has no clipboard at all', async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  render(<CopyValue label="issuer" value={ISSUER} />);
  await user.click(screen.getByRole('button', { name: 'Copy issuer' }));
  expect(screen.getByRole('status')).toHaveTextContent('Could not copy issuer');
});

it('announces a repeated copy afresh', async () => {
  const user = userEvent.setup();
  render(<CopyValue label="issuer" value={ISSUER} />);
  const status = screen.getByRole('status');
  const heard: string[] = [];
  const observer = new MutationObserver(() => {
    heard.push(status.textContent);
  });
  observer.observe(status, { childList: true, characterData: true, subtree: true });
  await user.click(screen.getByRole('button', { name: 'Copy issuer' }));
  await user.click(screen.getByRole('button', { name: 'Copy issuer' }));
  observer.disconnect();
  expect(heard).toEqual(['Copied issuer', '', 'Copied issuer']);
});

it('shortens an id it shows, and copies it whole', async () => {
  const user = userEvent.setup();
  const id = '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e';
  render(<CopyValue label="client id" value={id} short />);
  expect(screen.getByText('0192f7a4…')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Copy client id' }));
  expect(await navigator.clipboard.readText()).toBe(id);
});

it('shows a document on lines of its own, and copies it whole', async () => {
  const user = userEvent.setup();
  const document = '{\n  "issuer": "https://id.example.com/acme"\n}';
  render(<CopyValue label="discovery document" value={document} block />);
  const shown = screen.getByRole('region', { name: 'discovery document' });
  expect(shown.tagName).toBe('PRE');
  expect(shown).toHaveAttribute('tabindex', '0');
  expect(shown).toHaveTextContent('"issuer"');
  await user.click(screen.getByRole('button', { name: 'Copy discovery document' }));
  expect(await navigator.clipboard.readText()).toBe(document);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <CopyValue label="issuer" value={ISSUER} />)).toEqual({
    light: [],
    dark: [],
  });
});
