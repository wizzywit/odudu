import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { draftsKept } from '#/testing/consoleState';
import {
  brandingRoutes,
  draftedView,
  EMPTY,
  languagesRoutes,
  LOGO_ID,
  MC,
  MO,
  OWN_LIGHT,
  PI,
  SH,
  previewInfo,
  TH,
  themeAnswer,
  themeView,
  VERSION_1,
  versionsAnswer,
} from '#/testing/brandingFixtures';
import { inTurn, json, problem } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { ST } from '#/testing/settingsFixtures';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding';

const failingLight = { ...OWN_LIGHT, inkPrimary: '#bbbbbb' };

function failingDraft() {
  return themeView({
    draft: { ...EMPTY, tokens: { light: failingLight } },
    sources: {},
    draft_sources: { 'tokens.light': 'tenant' },
    changed: ['tokens'],
  });
}

async function colours() {
  return screen.findByRole('region', { name: 'Colours and font' });
}

it('shows which layer supplies each piece', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await colours();
  expect(within(section).getByText('Draft: this tenant · Published: this tenant')).toBeVisible();
  // The font and the dark palette are set by nobody.
  expect(
    within(section).getAllByText('Draft: Instrument’s default · Published: Instrument’s default'),
  ).toHaveLength(2);
  const images = screen.getByRole('region', { name: 'Images' });
  expect(
    within(images).getByText('Draft: this tenant · Published: Instrument’s default'),
  ).toBeVisible();
});

it('says what is published and what is only a draft', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const bar = await screen.findByRole('region', { name: 'Publish' });
  expect(within(bar).getByText('Version 1 is published.')).toBeVisible();
  expect(within(bar).getByText('Changed: Images')).toBeVisible();
});

describe('contrast', () => {
  it('a failing contrast pair blocks publish and names the pair', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(failingDraft(), '"d1"')));
    const publish = await screen.findByRole('region', { name: 'Publish' });
    expect(within(publish).getByRole('button', { name: 'Publish the draft' })).toBeDisabled();
    expect(within(publish).getByRole('note')).toHaveTextContent(
      /Fix the contrast before publishing: Light: Text on page, 1\.\d:1, needs 4\.5:1/u,
    );
    const contrast = screen.getByRole('region', { name: 'Contrast' });
    expect(within(contrast).getByText(/pairs? fails? its requirement/u)).toBeVisible();
    expect(within(contrast).getByRole('status')).toHaveTextContent(/^Contrast fails/u);
  });

  it('is judged as colours are typed, before anything is saved', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    const section = await colours();
    const contrast = screen.getByRole('region', { name: 'Contrast' });
    expect(within(contrast).getByText(/^All 18 pairs meet/u)).toBeVisible();
    expect(within(contrast).getByRole('status')).toHaveTextContent('Contrast passes.');
    const text = within(section).getByRole('textbox', { name: 'Light text' });
    await user.clear(text);
    await user.type(text, '#cccccc');
    expect(within(contrast).getByRole('status')).toHaveTextContent(/^Contrast fails/u);
    expect(within(contrast).getByText(/Light: Text on page, 1\.\d:1, needs 4\.5:1/u)).toBeVisible();
  });

  it('holds Save while a colour is not a finished #rrggbb', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    const section = await colours();
    const text = within(section).getByRole('textbox', { name: 'Light text' });
    await user.clear(text);
    await user.type(text, '#12');
    expect(within(section).getAllByText('A colour as #rrggbb.').length).toBeGreaterThan(0);
    expect(within(section).getByRole('button', { name: /Save/u })).toBeDisabled();
  });
});

describe('saving the draft', () => {
  it('sends the first save with no If-Match, and the next with the draft’s tag', async () => {
    const user = userEvent.setup();
    const saved = draftedView();
    const { sent } = renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(themeView()), {
        [`PUT ${TH}`]: json(saved, 200, { etag: '"d1"' }),
      }),
    );
    const section = await colours();
    await user.click(within(section).getByRole('switch', { name: 'Use my own light colours' }));
    await user.click(within(section).getByRole('button', { name: /Save/u }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'PUT')).toBe(true);
    });
    const put = sent.find((s) => s.method === 'PUT');
    expect(put?.ifMatch).toBeNull();
    expect(put?.body).toMatchObject({ tokens: { light: { surfacePage: '#e7eae9' } } });
    await user.click(within(section).getByRole('switch', { name: 'Use my own dark colours' }));
    await user.click(within(section).getByRole('button', { name: /Save/u }));
    await waitFor(() => {
      expect(sent.filter((s) => s.method === 'PUT')).toHaveLength(2);
    });
    expect(sent.filter((s) => s.method === 'PUT')[1]?.ifMatch).toBe('"d1"');
  });

  it('a 412 offers keep mine or take theirs', async () => {
    const user = userEvent.setup();
    const theirs = draftedView();
    renderConsoleAt(
      AT,
      brandingRoutes(
        inTurn(
          themeAnswer(draftedView(), '"d1"'),
          themeAnswer(
            { ...theirs, draft: { ...EMPTY, tokens: { light: OWN_LIGHT, dark: OWN_LIGHT } } },
            '"d2"',
          ),
        ),
        { [`PUT ${TH}`]: problem(412, 'about:blank', 'Precondition Failed') },
      ),
    );
    const section = await colours();
    await user.click(within(section).getByRole('switch', { name: 'Use my own dark colours' }));
    await user.click(within(section).getByRole('button', { name: /Save/u }));
    expect(await within(section).findByRole('button', { name: /Keep mine/u })).toBeVisible();
    expect(within(section).getByRole('button', { name: /Take theirs/u })).toBeVisible();
  });

  it('a first save met by somebody else’s first save offers keep mine or take theirs', async () => {
    const user = userEvent.setup();
    const theirs = themeView({
      draft: { ...EMPTY, tokens: { dark: OWN_LIGHT } },
      draft_sources: { 'tokens.dark': 'tenant' },
    });
    renderConsoleAt(
      AT,
      brandingRoutes(inTurn(themeAnswer(themeView()), themeAnswer(theirs, '"d1"')), {
        [`PUT ${TH}`]: problem(428, 'about:blank', 'Precondition Required'),
      }),
    );
    const section = await colours();
    await user.click(within(section).getByRole('switch', { name: 'Use my own dark colours' }));
    await user.click(within(section).getByRole('button', { name: /Save/u }));
    expect(await within(section).findByRole('button', { name: /Keep mine/u })).toBeVisible();
    expect(within(section).getByRole('button', { name: /Take theirs/u })).toBeVisible();
    expect(section).not.toHaveTextContent('fault in the console');
  });

  it('shows the server’s refusal of a template under it, by path', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      `${AT}?tab=pages`,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`PUT ${TH}`]: problem(400, 'about:blank', 'Bad Request', {
          errors: [
            {
              path: 'templates.sign-in',
              message: 'Needs {{form.close}} once.',
              line: 2,
              column: 4,
            },
          ],
        }),
      }),
    );
    const section = await screen.findByRole('region', { name: 'Page templates' });
    const box = within(section).getByRole('textbox', { name: 'Sign in: template' });
    await user.click(box);
    await user.paste('<p>{{form.open}}</p>');
    await user.click(within(section).getByRole('button', { name: /Save/u }));
    expect(await within(section).findByText(/Needs \{\{form\.close\}\} once\./u)).toBeVisible();
  });
});

describe('publishing', () => {
  it('publishes the saved draft on its tag and says what could not be checked', async () => {
    const user = userEvent.setup();
    const published = {
      ...draftedView(),
      draft: null,
      draft_sources: null,
      warnings: [
        {
          piece: 'stylesheet',
          code: 'stylesheet-unverified',
          message: 'Cannot be proven to pass.',
        },
      ],
    };
    const { sent } = renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`POST ${TH}/publish`]: json(published),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Publish' });
    await user.click(within(panel).getByRole('button', { name: 'Publish the draft' }));
    expect(await within(panel).findByText(/stylesheet: Cannot be proven to pass\./u)).toBeVisible();
    expect(sent.find((s) => s.method === 'POST')?.ifMatch).toBe('"d1"');
  });

  it('lists what the server refused, with its place', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`POST ${TH}/publish`]: problem(400, 'about:blank', 'Bad Request', {
          errors: [{ path: 'templates.sign-in', message: 'An unknown slot.', line: 3, column: 1 }],
        }),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Publish' });
    await user.click(within(panel).getByRole('button', { name: 'Publish the draft' }));
    expect(
      await within(panel).findByText('templates.sign-in: An unknown slot. (line 3, column 1)'),
    ).toBeVisible();
  });

  it('is held when there is no draft, and when edits are unsaved', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
    const panel = await screen.findByRole('region', { name: 'Publish' });
    expect(within(panel).getByRole('note')).toHaveTextContent('There is no draft to publish');
    const section = await colours();
    await user.click(within(section).getByRole('switch', { name: 'Use my own light colours' }));
    expect(within(panel).getByRole('note')).toHaveTextContent('Save your changes first');
  });
});

describe('versions', () => {
  it('lists them and offers Restore on those not published', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    const panel = await screen.findByRole('region', { name: 'Versions' });
    const table = await within(panel).findByRole('grid', { name: 'Theme versions' });
    expect(within(table).getByText('Version 2')).toBeVisible();
    expect(within(table).getByRole('button', { name: 'Restore Version 1' })).toBeVisible();
    expect(within(table).queryByRole('button', { name: 'Restore Version 2' })).toBeNull();
  });

  it('restores a version only once confirmed', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`POST ${TH}/versions/${VERSION_1.id}/restore`]: json(draftedView()),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Versions' });
    await user.click(await within(panel).findByRole('button', { name: 'Restore Version 1' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(sent.some((s) => s.method === 'POST')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'POST')).toBe(true);
    });
  });

  it('says a restore was refused for a deleted image', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`POST ${TH}/versions/${VERSION_1.id}/restore`]: problem(
          409,
          'about:blank#theme-assets-missing',
          'Conflict',
        ),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Versions' });
    await user.click(await within(panel).findByRole('button', { name: 'Restore Version 1' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await within(dialog).findByText(/an image it names has been deleted/u)).toBeVisible();
  });

  it('shows nothing published yet as plainly as that', async () => {
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(themeView()), {
        [`GET ${TH}/versions`]: versionsAnswer([]),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Versions' });
    expect(await within(panel).findByText('Nothing has been published yet.')).toBeVisible();
  });
});

describe('reset', () => {
  it('reset to default asks first, and says what it removes', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`DELETE ${TH}`]: json(themeView()),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Reset to default' });
    await user.click(within(panel).getByRole('button', { name: 'Reset to default…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Deletes the draft and unpublishes the theme');
    expect(dialog).toHaveTextContent('stays in Versions');
    expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'DELETE')).toBe(true);
    });
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    const panel = await screen.findByRole('region', { name: 'Reset to default' });
    await user.click(within(panel).getByRole('button', { name: 'Reset to default…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
  });
});

describe('the preview', () => {
  it('preview frames the production route with sandbox and no allow-same-origin', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    const frame = await screen.findByTitle('Preview of the page');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(frame.getAttribute('src')).toBe(
      '/console/api/admin/tenants/acme/theme/preview?kind=sign-in&scheme=light',
    );
    expect(frame.getAttribute('srcdoc')).toBeNull();
  });

  it('asks for the dark scheme when it is chosen', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    await screen.findByTitle('Preview of the page');
    await user.click(screen.getByRole('button', { name: /Colour scheme/u }));
    await user.click(await screen.findByRole('option', { name: 'Dark' }));
    expect(screen.getByTitle('Preview of the page').getAttribute('src')).toContain('scheme=dark');
  });

  it('follows the page chosen on the Pages tab, and says when it leaves a script out', async () => {
    const user = userEvent.setup();
    renderConsoleAt(`${AT}?tab=pages`, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    await screen.findByRole('region', { name: 'Page templates' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Page' }), 'Passkey set-up');
    expect(screen.getByTitle('Preview of the page').getAttribute('src')).toContain(
      'kind=passkey-enrolment',
    );
    expect(screen.getByText(/leaves out/u)).toBeVisible();
  });
});

describe('the Pages tab', () => {
  it('shows the parts a page may use, each placed once', async () => {
    renderConsoleAt(`${AT}?tab=pages`, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    const parts = await screen.findByRole('region', { name: 'Parts of this page' });
    expect(within(parts).getByText('{{form.open}}')).toBeVisible();
    expect(within(parts).getByText('{{passkey}}')).toBeVisible();
    expect(
      within(parts).getByText(/Between \{\{form\.open\}\} and \{\{form\.close\}\}/u),
    ).toBeVisible();
    expect(within(parts).getByText(/\{\{t "key"\}\}/u)).toBeVisible();
  });

  it('saves only the non-empty templates', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      `${AT}?tab=pages`,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`PUT ${TH}`]: json(draftedView(), 200, { etag: '"d2"' }),
      }),
    );
    const section = await screen.findByRole('region', { name: 'Page templates' });
    await user.click(within(section).getByRole('textbox', { name: 'Sign in: template' }));
    await user.paste('<main>{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}</main>');
    await user.click(within(section).getByRole('button', { name: /Save/u }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'PUT')).toBe(true);
    });
    const body = sent.find((s) => s.method === 'PUT')?.body as {
      templates: object;
      tokens: object;
    };
    expect(Object.keys(body.templates)).toEqual(['sign-in']);
    expect(Object.keys(body.tokens)).toEqual(['light']);
  });
});

describe('the area', () => {
  it('offers Theme, Pages, Mail and Languages', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    const tabs = await screen.findByRole('tablist', { name: 'Branding sections' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent.split(',')[0]),
    ).toEqual(['Theme', 'Pages', 'Mail', 'Languages']);
  });

  it('names manage-tenant for a caller without it, and reads nothing', async () => {
    const { calls } = renderConsoleAt(AT, brandingRoutes(themeAnswer(), {}, ['manage-clients']));
    expect(await screen.findByRole('note')).toHaveTextContent('manage-tenant');
    expect(calls.some((call) => call.path === TH)).toBe(false);
  });

  it('says the theme could not be loaded, and tries again', async () => {
    renderConsoleAt(
      AT,
      brandingRoutes(json({ type: 'about:blank', title: 'x', status: 500 }, 500)),
    );
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('keeps edits as a draft, keyed by tenant', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
    const section = await colours();
    await user.click(within(section).getByRole('switch', { name: 'Use my own light colours' }));
    const kept = draftsKept('s1');
    expect(kept.sections).toBe(1);
    expect(kept.stored).toContain('acme/theme');
  });

  it('works from the keyboard alone', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
    const section = await colours();
    const light = within(section).getByRole('switch', { name: 'Use my own light colours' });
    for (let step = 0; step < 80 && document.activeElement !== light; step += 1) {
      await user.tab();
    }
    expect(light).toHaveFocus();
    await user.keyboard(' ');
    expect(light).toBeChecked();
    expect(
      await within(section).findByRole('textbox', { name: 'Light page background' }),
    ).toBeVisible();
    for (let step = 0; step < 80; step += 1) {
      await user.tab();
      if (document.activeElement?.textContent.startsWith('Save') === true) break;
    }
    expect(document.activeElement).toHaveTextContent(/^Save/u);
  });
});

describe('images', () => {
  async function images() {
    return screen.findByRole('region', { name: 'Images' });
  }

  function fileInput(section: HTMLElement, index: number): HTMLInputElement {
    const inputs = section.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const found = inputs[index];
    if (found === undefined) throw new Error('no file input');
    return found;
  }

  const PNG = () =>
    new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });

  it('states each kind’s limits beside its upload', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
    const section = await images();
    expect(within(section).getAllByText(/up to 256 KiB and 1024 pixels/u)).toHaveLength(3);
    expect(within(section).getByText(/up to 1 MiB and 2560 pixels/u)).toBeVisible();
    expect(within(section).getAllByText(/8 MiB/u).length).toBeGreaterThan(0);
  });

  it('uploads the image as the body, names the slot, and fills it with the new image', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(themeView()), {
        [`POST ${TH}/assets`]: json(
          {
            id: LOGO_ID,
            sha256: 'x',
            mime: 'image/png',
            width: 10,
            height: 10,
            bytes: 4,
            kind: 'logo',
          },
          201,
        ),
      }),
    );
    const section = await images();
    await user.upload(fileInput(section, 0), PNG());
    expect(await within(section).findByText('An image is set (a1b2c3d4).')).toBeVisible();
    expect(sent.find((s) => s.method === 'POST')?.search.get('kind')).toBe('logo');
    expect(within(section).getByRole('textbox', { name: 'Logo: alt text' })).toHaveValue('');
    expect(within(section).getByRole('button', { name: /Save/u })).toBeDisabled();
  });

  it('refuses a file over the limit without sending it', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
    const section = await images();
    const big = new File([new Uint8Array(300 * 1024)], 'big.png', { type: 'image/png' });
    await user.upload(fileInput(section, 0), big);
    expect(
      await within(section).findByText('That image is over 256 KiB, the most a logo may be.'),
    ).toBeVisible();
    expect(sent.some((s) => s.method === 'POST')).toBe(false);
  });

  it.each([
    ['asset-unsupported-type', 415, 'That is not a PNG, a JPEG or a WebP.'],
    ['asset-animated', 422, 'An animated image is not accepted.'],
    ['asset-corrupt', 422, 'The image could not be read.'],
    [
      'asset-dimensions',
      422,
      'The image is over 1024 pixels on its longer side, or has too many pixels.',
    ],
    ['asset-timeout', 422, 'The image took too long to decode. Try a smaller one.'],
    ['asset-too-large', 413, 'The image is over 256 KiB for a logo, as uploaded or once stored.'],
    ['asset-cap', 409, 'The tenant’s images would pass 8 MiB. Delete one that no theme uses.'],
    ['asset-busy', 503, 'The server is busy decoding images. Try again in a moment.'],
  ])('words %s from the console’s own text, never the server’s', async (type, status, text) => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(themeView()), {
        [`POST ${TH}/assets`]: problem(status, `about:blank#${type}`, 'Refused', {
          detail: 'decoder said: secret internals',
        }),
      }),
    );
    const section = await images();
    await user.upload(fileInput(section, 0), PNG());
    const alert = await within(section).findByText(text);
    expect(alert).toBeVisible();
    expect(section).not.toHaveTextContent('secret internals');
  });

  it('shows the themes that still name an image it was asked to delete', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`DELETE ${TH}/assets/${LOGO_ID}`]: problem(409, 'about:blank#asset-in-use', 'Conflict', {
          detail: 'a theme still names the image',
          errors: [
            { path: 'theme', message: 'named by the draft d1' },
            { path: 'clients/c9/theme', message: 'named by published version 2 (v2)' },
          ],
        }),
      }),
    );
    const section = await images();
    await user.click(within(section).getByRole('button', { name: 'Delete image: logo' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete image' }));
    expect(await within(dialog).findByText(/still used by 2 themes/u)).toBeVisible();
    expect(dialog).toHaveTextContent('This tenant’s theme: named by the draft d1.');
    expect(dialog).toHaveTextContent('The theme at clients/c9/theme: named by published version 2');
  });

  it('removes an image from the theme as an edit, and requires alt text for a logo', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    const section = await images();
    const alt = within(section).getByRole('textbox', { name: 'Logo: alt text' });
    await user.clear(alt);
    expect(within(section).getByText('Describe the logo; it is required.')).toBeVisible();
    expect(within(section).getByRole('button', { name: /Save/u })).toBeDisabled();
    await user.click(within(section).getByRole('button', { name: 'Remove from theme: logo' }));
    expect(within(section).getAllByText('No image: the layer below supplies it.')).toHaveLength(4);
  });
});

describe('what the preview says about itself', () => {
  const group = () => screen.getByRole('status', { name: 'What the preview shows' });

  it('shows nothing when the draft is what the frame shows', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
    await screen.findByTitle('Preview of the page');
    await waitFor(() => {
      expect(screen.getByTitle('Preview of the page')).toBeVisible();
    });
    expect(within(group()).queryAllByRole('note')).toEqual([]);
  });

  it('says which layer is shown and why, from the answer for the same page and scheme', async () => {
    const { sent } = renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`GET ${PI}`]: json(
          previewInfo({
            shown: 'default',
            faults: [{ layer: 'tenant', code: 'image_gone' }],
          }),
        ),
      }),
    );
    const notice = await screen.findByRole('status', { name: 'What the preview shows' });
    expect(
      await within(notice).findByText('The draft names an image that no longer exists.'),
    ).toBeVisible();
    expect(
      within(notice).getByText('The preview shows Instrument’s default look instead.'),
    ).toBeVisible();
    const asked = sent.find((request) => request.path === PI);
    expect(Object.fromEntries(asked?.search ?? [])).toEqual({ kind: 'sign-in', scheme: 'light' });
  });

  it('asks again for the page and the scheme chosen, and answers for them', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`GET ${PI}`]: (request) =>
          json(
            request.search.get('scheme') === 'dark'
              ? previewInfo({ kind: 'sign-in', unfilled: true })
              : previewInfo(),
          )(request),
      }),
    );
    await screen.findByTitle('Preview of the page');
    expect(within(group()).queryAllByRole('note')).toEqual([]);
    const preview = screen.getByRole('complementary');
    await user.click(within(preview).getByRole('button', { name: /Colour scheme/u }));
    await user.click(await screen.findByRole('option', { name: 'Dark' }));
    expect(await screen.findByText(/template could not be filled/u)).toBeVisible();
    const asks = sent.filter((request) => request.path === PI).map((r) => r.search.get('scheme'));
    expect(asks).toEqual(['light', 'dark']);
  });

  it('says so when it could not find out, rather than showing nothing', async () => {
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
        [`GET ${PI}`]: problem(500, 'about:blank', 'Internal Server Error'),
      }),
    );
    expect(
      await screen.findByText('The preview could not be checked for a fallback.'),
    ).toBeVisible();
  });

  it('is asked only where a preview is framed', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      `${AT}?tab=languages`,
      brandingRoutes(themeAnswer(draftedView(), '"d1"')),
    );
    await screen.findByRole('tab', { name: /Languages/u });
    expect(sent.some((request) => request.path === PI)).toBe(false);
    await user.click(screen.getByRole('tab', { name: /Pages/u }));
    await waitFor(() => {
      expect(sent.some((request) => request.path === PI)).toBe(true);
    });
  });
});

it('has nothing axe can find in either theme', async () => {
  const { element } = consoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('region', { name: 'Versions' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});

describe('what each tab reads', () => {
  const count = (sent: readonly { path: string }[], path: string): number =>
    sent.filter((request) => request.path === path).length;

  // An answer held back until `release`, for a read that is in flight.
  function held() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { gate, release };
  }

  it('reads nothing of the languages on Theme, and the hooks and versions once each', async () => {
    const { sent } = renderConsoleAt(AT, languagesRoutes());
    await colours();
    expect(count(sent, SH)).toBe(1);
    expect(count(sent, `${TH}/versions`)).toBe(1);
    expect(count(sent, ST)).toBe(0);
    expect(count(sent, MC)).toBe(0);
    expect(count(sent, MO)).toBe(0);
  });

  it('reads the catalogue once on Pages and nothing else of the languages', async () => {
    const { sent } = renderConsoleAt(`${AT}?tab=pages`, languagesRoutes());
    await screen.findByRole('combobox', { name: 'Page' });
    expect(count(sent, MC)).toBe(1);
    expect(count(sent, ST)).toBe(0);
    expect(count(sent, MO)).toBe(0);
  });

  it('reads the settings, the catalogue and the overrides once each on Languages', async () => {
    const { sent } = renderConsoleAt(`${AT}?tab=languages`, languagesRoutes());
    await screen.findByRole('grid', { name: 'Message overrides' });
    expect(count(sent, ST)).toBe(1);
    expect(count(sent, MC)).toBe(1);
    expect(count(sent, MO)).toBe(1);
  });

  it('asks for the languages’ reads while the theme is still arriving', async () => {
    const theme = held();
    const { sent } = renderConsoleAt(
      `${AT}?tab=languages`,
      languagesRoutes({
        [`GET ${TH}`]: async (request) => {
          await theme.gate;
          return themeAnswer(draftedView(), '"d1"')(request);
        },
      }),
    );
    await waitFor(() => {
      expect(count(sent, ST)).toBe(1);
      expect(count(sent, MC)).toBe(1);
    });
    theme.release();
    await screen.findByRole('grid', { name: 'Message overrides' });
  });

  it('asks for the hooks and the versions while the theme is still arriving', async () => {
    const theme = held();
    const { sent } = renderConsoleAt(
      AT,
      languagesRoutes({
        [`GET ${TH}`]: async (request) => {
          await theme.gate;
          return themeAnswer(draftedView(), '"d1"')(request);
        },
      }),
    );
    await waitFor(() => {
      expect(count(sent, SH)).toBe(1);
      expect(count(sent, `${TH}/versions`)).toBe(1);
    });
    theme.release();
    await colours();
  });

  it('reads the catalogue once across Pages and Languages, and not again on return', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(`${AT}?tab=pages`, languagesRoutes());
    await screen.findByRole('combobox', { name: 'Page' });
    await user.click(screen.getByRole('tab', { name: /^Languages/u }));
    await screen.findByRole('grid', { name: 'Message overrides' });
    await user.click(screen.getByRole('tab', { name: /^Pages/u }));
    await screen.findByRole('combobox', { name: 'Page' });
    expect(count(sent, MC)).toBe(1);
  });
});
