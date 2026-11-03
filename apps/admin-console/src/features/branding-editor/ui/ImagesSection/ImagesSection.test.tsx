import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import {
  assetContent,
  brandingRoutes,
  draftedView,
  LOGO_ID,
  themeAnswer,
  themeView,
} from '#/testing/brandingFixtures';
import { image, inTurn, pending, problem } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding';

it('has one slot for each image a theme may name, each with what it is for', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
  const section = await screen.findByRole('region', { name: 'Images' });
  for (const name of ['Logo', 'Logo for the dark scheme', 'Favicon', 'Background image']) {
    expect(within(section).getByRole('group', { name })).toBeVisible();
  }
  expect(within(section).getByText('The icon in the browser tab.')).toBeVisible();
});

it('offers Replace, Remove and Delete for a slot that holds an image, Upload for the others', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await screen.findByRole('region', { name: 'Images' });
  expect(within(section).getByRole('button', { name: 'Replace logo' })).toBeVisible();
  expect(within(section).getByRole('button', { name: 'Upload favicon' })).toBeVisible();
  expect(within(section).queryByRole('button', { name: 'Delete image: favicon' })).toBeNull();
});

const FAVICON_ID = 'a1b2c3d4-0000-4000-8000-000000000002';
const SRC_OF_LOGO = 'data:image/png;base64,iVBOR/8A';

it('shows the image a slot holds under the logo’s alt text, though no theme has published it', async () => {
  renderConsoleAt(
    AT,
    brandingRoutes(themeAnswer(draftedView({ favicon: { assetId: FAVICON_ID } }), '"d1"'), {
      [assetContent(FAVICON_ID)]: image(new Uint8Array([1, 2, 3]), 'image/webp'),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Images' });
  const logo = await within(within(section).getByRole('group', { name: 'Logo' })).findByRole(
    'img',
    {
      name: 'Acme',
    },
  );
  expect(logo.getAttribute('src')).toBe(SRC_OF_LOGO);
  const favicon = await within(within(section).getByRole('group', { name: 'Favicon' })).findByRole(
    'img',
    { name: 'Favicon' },
  );
  expect(favicon.getAttribute('src')).toMatch(/^data:image\/webp;base64,/u);
});

it('shows no picture for a slot that holds nothing', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await screen.findByRole('region', { name: 'Images' });
  await within(within(section).getByRole('group', { name: 'Logo' })).findByRole('img');
  expect(
    within(within(section).getByRole('group', { name: 'Favicon' })).queryByRole('img'),
  ).toBeNull();
});

it('reads each image once, and keeps what it read when the page reads the theme again', async () => {
  const fake = renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  await screen.findByRole('img', { name: 'Acme' });
  const reads = fake.calls.filter((call) => call.path.endsWith(`${LOGO_ID}/content`));
  expect(reads).toHaveLength(1);
});

it('does not read an image again when the window regains focus, as it does the theme', async () => {
  const fake = renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  await screen.findByRole('img', { name: 'Acme' });
  const themeReads = () => fake.calls.filter((call) => call.path.endsWith('/theme')).length;
  const imageReads = () =>
    fake.calls.filter((call) => call.path.endsWith(`${LOGO_ID}/content`)).length;
  const before = themeReads();

  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });

  await waitFor(() => {
    expect(themeReads()).toBeGreaterThan(before);
  });
  expect(imageReads()).toBe(1);
});

it('says an image could not be shown, and shows it once the read is tried again', async () => {
  renderConsoleAt(
    AT,
    brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
      [assetContent(LOGO_ID)]: inTurn(
        problem(404),
        image(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00])),
      ),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Images' });
  const group = within(section).getByRole('group', { name: 'Logo' });
  expect(await within(group).findByText('The image could not be shown.')).toBeVisible();
  await userEvent.click(within(group).getByRole('button', { name: 'Try again' }));
  expect(await within(group).findByRole('img', { name: 'Acme' })).toBeVisible();
});

it('says it is loading while the image is on its way', async () => {
  renderConsoleAt(
    AT,
    brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
      [assetContent(LOGO_ID)]: pending(),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Images' });
  const group = within(section).getByRole('group', { name: 'Logo' });
  expect(await within(group).findByText('Loading the image…')).toBeVisible();
});

it('has nothing axe can find in either theme', async () => {
  const { element } = consoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('region', { name: 'Images' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});
