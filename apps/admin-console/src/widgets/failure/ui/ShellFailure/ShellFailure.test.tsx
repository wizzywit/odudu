import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { failingAt } from '#/testing/mountFailing';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  vi.restoreAllMocks();
});

function failing(): never {
  throw new Error('the shell failed');
}

it('stands alone under the product name, with the panel and a way back to the tenant', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(failingAt('/acme/clients', failing, true));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getByRole('main')).toHaveTextContent('odudu');
  expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
    'href',
    '/console/acme',
  );
  expect(screen.getByRole('region', { name: 'error details' })).toHaveTextContent(
    'Page: /$tenant/clients',
  );
});

it('passes axe in both themes', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(
    await axeInBothThemes(
      () => failingAt('/acme/clients', failing, true),
      () => screen.findByRole('alert'),
    ),
  ).toEqual({ light: [], dark: [] });
});
