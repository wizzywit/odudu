import { screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { settingsRoutes } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/settings';

it('lays a section out in its titled groups, each control with its own description', async () => {
  renderConsoleAt(AT, settingsRoutes());
  const agents = await screen.findByRole('region', { name: 'Agents' });
  for (const group of ['Instances', 'Approvals', 'Writes']) {
    expect(within(agents).getByText(group)).toBeVisible();
  }
  expect(within(agents).getByRole('textbox', { name: 'Delegation depth' })).toHaveValue('3');
  expect(
    within(agents).getByText(/How many instances deep one delegation may go\./u),
  ).toBeVisible();
});

it('passes axe in both themes, with every kind of control a section draws', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, settingsRoutes()).element,
      () => screen.findByRole('region', { name: 'Agents' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
