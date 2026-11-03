import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { languagesRoutes } from '#/testing/brandingFixtures';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';
import { settingsAnswer, ST } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding?tab=languages';

it('saves the default language on the one tag that stands for the settings', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    languagesRoutes({
      [`PATCH ${ST}`]: settingsAnswer(
        { supported_locales: ['en', 'ar'], default_locale: 'ar' },
        '"s2"',
      ),
    }),
  );
  await screen.findByRole('grid', { name: 'Message overrides' });
  await user.click(screen.getByRole('button', { name: /Default language/u }));
  await user.click(await screen.findByRole('option', { name: /Arabic/u }));
  await user.click(screen.getByRole('button', { name: /^Save Languages/u }));
  await waitFor(() => {
    expect(sent.find((request) => request.method === 'PATCH')?.body).toEqual({
      default_locale: 'ar',
    });
  });
  expect(sent.find((request) => request.method === 'PATCH')?.ifMatch).toBe('"s1"');
});

it('clears the default language by sending it empty, so the browser decides again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    languagesRoutes(
      {
        [`PATCH ${ST}`]: settingsAnswer(
          { supported_locales: ['en', 'ar'], default_locale: null },
          '"s2"',
        ),
      },
      { supported_locales: ['en', 'ar'], default_locale: 'ar' },
    ),
  );
  await screen.findByRole('grid', { name: 'Message overrides' });
  await user.click(screen.getByRole('button', { name: /Default language/u }));
  await user.click(await screen.findByRole('option', { name: 'The browser decides' }));
  await user.click(screen.getByRole('button', { name: /^Save Languages/u }));
  await waitFor(() => {
    expect(sent.find((request) => request.method === 'PATCH')?.body).toEqual({
      default_locale: '',
    });
  });
});

it('adds a language by its tag, lists it ticked, and saves the whole list', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    languagesRoutes({
      [`PATCH ${ST}`]: settingsAnswer({ supported_locales: ['en', 'ar', 'pt-BR'] }, '"s2"'),
    }),
  );
  await screen.findByRole('grid', { name: 'Message overrides' });
  await user.type(screen.getByRole('combobox', { name: /Add a language/u }), 'pt-BR');
  await user.click(screen.getByRole('button', { name: 'Add language' }));
  expect(await screen.findByRole('checkbox', { name: /pt-BR/u })).toBeChecked();
  await user.click(screen.getByRole('button', { name: /^Save Languages/u }));
  await waitFor(() => {
    expect(sent.find((request) => request.method === 'PATCH')?.body).toEqual({
      supported_locales: ['en', 'ar', 'pt-BR'],
    });
  });
});

it('adds the typed tag on Enter and does not save the section', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, languagesRoutes());
  await screen.findByRole('grid', { name: 'Message overrides' });
  await user.type(screen.getByRole('combobox', { name: /Add a language/u }), 'pt-BR{Enter}');
  expect(await screen.findByRole('checkbox', { name: /pt-BR/u })).toBeChecked();
  expect(sent.some((request) => request.method === 'PATCH')).toBe(false);
});

// A tag that arrives whole has its option chosen and pointed at; jsdom does
// not reproduce that, so the e2e "adds a language by its tag with Enter" pins it.
it('adds the tag once when Enter is pressed on the Add language button', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, languagesRoutes());
  await screen.findByRole('grid', { name: 'Message overrides' });
  await user.type(screen.getByRole('combobox', { name: /Add a language/u }), 'pt-BR');
  screen.getByRole('button', { name: 'Add language' }).focus();
  await user.keyboard('{Enter}');
  expect(await screen.findAllByRole('checkbox', { name: /pt-BR/u })).toHaveLength(1);
  expect(screen.queryByText('That language is already offered.')).toBeNull();
});

it('marks the tab with an unsaved dot while a language is added and not saved', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, languagesRoutes());
  await screen.findByRole('grid', { name: 'Message overrides' });
  expect(screen.getByRole('tab', { name: 'Languages' })).toBeInTheDocument();
  await user.type(screen.getByRole('combobox', { name: /Add a language/u }), 'pt-BR');
  await user.click(screen.getByRole('button', { name: 'Add language' }));
  expect(
    await screen.findByRole('tab', { name: 'Languages, unsaved changes' }),
  ).toBeInTheDocument();
});

it('names the Add control where it says which languages stay listed', async () => {
  renderConsoleAt(AT, languagesRoutes());
  expect(await screen.findByText(/“Add a language” below/u)).toBeVisible();
});

it('refuses to add a tag that is not one, and one already offered, sending nothing', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, languagesRoutes());
  await screen.findByRole('grid', { name: 'Message overrides' });
  const field = screen.getByRole('combobox', { name: /Add a language/u });
  await user.type(field, 'en_US');
  await user.click(screen.getByRole('button', { name: 'Add language' }));
  expect(await screen.findByText(/type a tag such as/u)).toBeVisible();
  await user.clear(field);
  await user.type(field, 'AR');
  await user.click(screen.getByRole('button', { name: 'Add language' }));
  expect(await screen.findByText('That language is already offered.')).toBeVisible();
  expect(sent.some((request) => request.method === 'PATCH')).toBe(false);
});

it('holds the section when no language is left supported', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, languagesRoutes({}, { supported_locales: ['en'] }));
  await user.click(await screen.findByRole('checkbox', { name: /English/u }));
  expect(await screen.findByText('Offer at least one language.')).toBeVisible();
});

it('has nothing axe can find in either theme', async () => {
  const { element } = consoleAt(AT, languagesRoutes());
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('grid', { name: 'Message overrides' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});
