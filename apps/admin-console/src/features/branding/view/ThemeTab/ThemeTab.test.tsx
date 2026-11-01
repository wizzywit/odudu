import { screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { brandingRoutes, draftedView, themeAnswer } from '#/testing/brandingFixtures';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding';

it('holds the panels in the order a theme is made: publication, look, then undo', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  await screen.findByRole('region', { name: 'Versions' });
  const names = screen
    .getAllByRole('region')
    .map((region) => region.getAttribute('aria-label') ?? region.querySelector('h2')?.textContent);
  const shown = names.filter((name) =>
    [
      'Publish',
      'Colours and font',
      'Contrast',
      'Images',
      'Revert to published',
      'Versions',
      'Reset to default',
      'Preview',
    ].includes(name ?? ''),
  );
  expect(shown).toEqual([
    'Publish',
    'Colours and font',
    'Contrast',
    'Images',
    'Revert to published',
    'Versions',
    'Reset to default',
    'Preview',
  ]);
});

it('has nothing axe can find in either theme', async () => {
  const { element } = consoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('region', { name: 'Reset to default' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});
