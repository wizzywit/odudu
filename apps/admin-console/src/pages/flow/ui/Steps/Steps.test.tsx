import { screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { flowRoutes } from '#/testing/flowFixtures';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt } from '#/testing/renderConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

it('draws the steps of the default flow, in order, and passes axe in both themes', async () => {
  const names = (): string[] =>
    within(screen.getByRole('list', { name: 'Sign-in steps' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('code')?.textContent ?? '');
  expect(
    await axeInBothThemes(
      () => consoleAt('/console/acme/flow', flowRoutes()).element,
      async () => {
        await screen.findByRole('region', { name: 'Steps' });
        expect(names()).toEqual(['passkey', 'password', 'otp']);
        return screen.getByRole('list', { name: 'Sign-in steps' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
