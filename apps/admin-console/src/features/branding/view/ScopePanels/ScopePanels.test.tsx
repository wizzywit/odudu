import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function routes() {
  return brandingRoutes(themeAnswer(draftedView(), '"d1"'));
}

it('puts the theme editor beside a preview that picks the page', async () => {
  renderConsoleAt(AT, routes());
  await screen.findByRole('region', { name: 'Colours and font' });
  const preview = screen.getByRole('complementary');
  expect(within(preview).getByRole('region', { name: 'Preview' })).toBeVisible();
});

it('puts the page templates beside a preview that follows the template’s page', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, routes());
  await user.click(await screen.findByRole('tab', { name: /Pages/u }));
  await screen.findByRole('region', { name: 'Page templates' });
  expect(
    within(screen.getByRole('complementary')).getByRole('region', { name: 'Preview' }),
  ).toBeVisible();
});

it('has nothing axe can find in either theme', async () => {
  const { element } = consoleAt(AT, routes());
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('region', { name: 'Colours and font' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});
