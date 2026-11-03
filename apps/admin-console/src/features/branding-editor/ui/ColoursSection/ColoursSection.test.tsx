import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { brandingRoutes, draftedView, themeAnswer, themeView } from '#/testing/brandingFixtures';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding';

it('keeps a scheme Instrument’s own until it is customised, then starts from Instrument’s colours', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
  const section = await screen.findByRole('region', { name: 'Colours and font' });
  expect(within(section).queryByRole('textbox', { name: 'Light page background' })).toBeNull();
  await user.click(within(section).getByRole('switch', { name: 'Use my own light colours' }));
  expect(within(section).getByRole('textbox', { name: 'Light page background' })).toHaveValue(
    '#e7eae9',
  );
  expect(within(section).getAllByRole('textbox')).toHaveLength(11);
});

it('folds each palette under its legend, closed until it is pressed', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
  const section = await screen.findByRole('region', { name: 'Colours and font' });
  const fold = within(section).getByRole('button', { name: 'Light colours' });
  expect(fold).toHaveAttribute('aria-expanded', 'false');
  const body = document.getElementById(fold.getAttribute('aria-controls') ?? '');
  expect(body).toHaveAttribute('data-collapsed');
  await user.click(fold);
  expect(within(section).getByRole('button', { name: 'Light colours' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(body).not.toHaveAttribute('data-collapsed');
  expect(within(section).getByRole('button', { name: 'Dark colours' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

it('keeps a palette open that holds a colour to fix', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await screen.findByRole('region', { name: 'Colours and font' });
  const text = within(section).getByRole('textbox', { name: 'Light text' });
  await user.clear(text);
  await user.type(text, '#00');
  const fold = within(section).getByRole('button', { name: 'Light colours' });
  expect(fold).toHaveAttribute('aria-expanded', 'true');
  await user.click(fold);
  expect(fold).toHaveAttribute('aria-expanded', 'true');
});

it('marks a colour changed once it differs from the saved one', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await screen.findByRole('region', { name: 'Colours and font' });
  expect(within(section).queryByText('Changed')).toBeNull();
  const text = within(section).getByRole('textbox', { name: 'Light text' });
  await user.clear(text);
  await user.type(text, '#000000');
  // The palette's own switch, and the one colour.
  expect(within(section).getAllByText('Changed')).toHaveLength(2);
});

it('shows every pair of a customised palette with its ratio', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const contrast = await screen.findByRole('region', { name: 'Contrast' });
  expect(within(contrast).getAllByRole('listitem')).toHaveLength(18);
  expect(
    within(contrast).getByText(/^Light: Text on page, \d+\.\d:1, needs 4\.5:1$/u),
  ).toBeVisible();
});

it('says Instrument’s own colours are used, and meet every requirement', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
  const contrast = await screen.findByRole('region', { name: 'Contrast' });
  expect(
    within(contrast).getByText(
      'Instrument’s own colours are used, and they meet every requirement.',
    ),
  ).toBeVisible();
});

it('has nothing axe can find in either theme', async () => {
  const { element } = consoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('region', { name: 'Contrast' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});
