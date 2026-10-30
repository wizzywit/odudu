import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import {
  brandingRoutes,
  EMPTY,
  OWN_LIGHT,
  TH,
  themeAnswer,
  themeView,
} from '#/testing/brandingFixtures';
import { inTurn, json, pending, problem } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding';
const PAGES = `${AT}?tab=pages`;
const TEMPLATE = '<main>{{form.open}}{{fields}}{{submit}}{{form.close}}</main>';

const PUBLISHED = { ...EMPTY, tokens: { light: OWN_LIGHT }, stylesheet: '.a { }' };
const DRAFT = {
  ...PUBLISHED,
  tokens: { light: OWN_LIGHT, dark: OWN_LIGHT },
  templates: { 'sign-in': TEMPLATE },
};

function published(body: object = PUBLISHED) {
  return { id: 'v1', version: 1, published_at: '2026-10-20T09:00:00.000Z', body };
}

// A draft with a change in the Theme tab (the dark colours) and one in the
// Pages tab (a sign-in template), over a published theme.
function twoTabs(changes: Record<string, unknown> = {}) {
  return themeView({
    draft: DRAFT,
    published: published(),
    changed: ['tokens', 'templates'],
    ...changes,
  });
}

function matching() {
  return themeView({ draft: PUBLISHED, published: published(), changed: [] });
}

const bar = () => screen.findByRole('region', { name: 'Publish' });

describe('the publication bar', () => {
  it('names what differs, in the words of the sections', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    expect(
      await within(await bar()).findByText('Changed: Colours and font, Page templates'),
    ).toBeVisible();
  });

  it('marks each tab that holds part of the change, and no other', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(twoTabs({ changed: ['templates'] }), '"d1"')));
    await bar();
    expect(screen.getByRole('tab', { name: 'Pages, changes to publish' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Theme' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Mail' })).toBeVisible();
  });

  it('sits above every tab, so Publish is one click from the Pages tab', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      PAGES,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), {
        [`POST ${TH}/publish`]: json({ ...matching(), warnings: [] }),
      }),
    );
    await user.click(await within(await bar()).findByRole('button', { name: 'Publish the draft' }));
    await waitFor(() => {
      expect(sent.filter((s) => s.method === 'POST').map((s) => s.path)).toEqual([`${TH}/publish`]);
    });
    expect(sent.find((s) => s.method === 'POST')?.ifMatch).toBe('"d1"');
  });

  it('shows on the Mail and Languages tabs too', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    await bar();
    await user.click(screen.getByRole('tab', { name: /^Mail/u }));
    expect(await bar()).toBeVisible();
  });

  it('holds Publish with the reason when the draft matches what people see', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(matching(), '"d1"')));
    const region = await bar();
    expect(within(region).getByRole('button', { name: 'Publish the draft' })).toBeDisabled();
    expect(within(region).getByRole('note')).toHaveTextContent(
      'Nothing to publish: the draft matches what people see.',
    );
    expect(within(region).getByText('The draft matches what people see.')).toBeVisible();
  });

  it('holds Publish while a tab has unsaved edits, whichever tab shows', async () => {
    const user = userEvent.setup();
    renderConsoleAt(PAGES, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    const section = await screen.findByRole('region', { name: 'Page templates' });
    await user.click(within(section).getByRole('textbox', { name: 'Sign in: template' }));
    await user.paste('x');
    expect((await within(await bar()).findAllByRole('note'))[0]).toHaveTextContent(
      'Save your changes first, in “Page templates”',
    );
  });

  it('says what the server refused when it refuses a publish of a draft it found equal', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), {
        [`POST ${TH}/publish`]: problem(409, 'about:blank#theme-nothing-to-publish', 'Conflict'),
      }),
    );
    const region = await bar();
    await user.click(within(region).getByRole('button', { name: 'Publish the draft' }));
    expect(
      await within(region).findByText('Nothing to publish: the draft matches what people see.'),
    ).toBeVisible();
  });
});

describe('discarding the draft', () => {
  it('asks first, says what stays, and sends nothing on Cancel', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(AT, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    await user.click(within(await bar()).getByRole('button', { name: 'Discard draft…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('what is published stays, and people keep seeing it');
    expect(dialog).toHaveTextContent('nothing is unpublished');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
  });

  it('after two tabs changed, removes the whole draft on its tag and keeps what is published', async () => {
    const user = userEvent.setup();
    const after = themeView({ draft: null, published: published(), changed: [] });
    const { sent } = renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), {
        [`DELETE ${TH}/draft`]: json(after),
      }),
    );
    const region = await bar();
    expect(screen.getByRole('tab', { name: 'Theme, changes to publish' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Pages, changes to publish' })).toBeVisible();
    await user.click(within(region).getByRole('button', { name: 'Discard draft…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
    await waitFor(() => {
      expect(within(region).getByText('No draft.')).toBeVisible();
    });
    const deletes = sent.filter((s) => s.method === 'DELETE');
    expect(deletes.map((s) => s.path)).toEqual([`${TH}/draft`]);
    expect(deletes[0]?.ifMatch).toBe('"d1"');
    expect(within(region).getByText('Version 1 is published.')).toBeVisible();
    expect(within(region).getByRole('button', { name: 'Discard draft…' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Theme' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeVisible();
  });

  it('says in the dialog that somebody saved meanwhile, when the tag is stale', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), {
        [`DELETE ${TH}/draft`]: problem(412, 'about:blank', 'Precondition Failed'),
      }),
    );
    await user.click(within(await bar()).getByRole('button', { name: 'Discard draft…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
    expect(await within(dialog).findByText(/Somebody saved the draft/u)).toBeVisible();
  });

  it('has no Discard to press when there is no draft', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(themeView())));
    expect(within(await bar()).getByRole('button', { name: 'Discard draft…' })).toBeDisabled();
  });
});

describe('reverting a tab', () => {
  it('on the Pages tab takes the templates back and leaves the Theme tab’s change', async () => {
    const user = userEvent.setup();
    const after = twoTabs({ draft: { ...DRAFT, templates: {} }, changed: ['tokens'] });
    const { sent } = renderConsoleAt(
      PAGES,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), {
        [`PUT ${TH}`]: json(after, 200, { etag: '"d2"' }),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Revert to published' });
    await user.click(within(panel).getByRole('button', { name: 'Revert this tab to published' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'PUT')).toBe(true);
    });
    const put = sent.find((s) => s.method === 'PUT');
    expect(put?.ifMatch).toBe('"d1"');
    expect(put?.body).toEqual({ ...DRAFT, templates: {} });
    expect(await within(await bar()).findByText('Changed: Colours and font')).toBeVisible();
    expect(await screen.findByRole('tab', { name: 'Theme, changes to publish' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeVisible();
    expect(within(panel).getByText('This tab already matches what is published.')).toBeVisible();
  });

  it('on the Theme tab takes the colours, images and stylesheet back and leaves the templates', async () => {
    const user = userEvent.setup();
    const after = twoTabs({
      draft: { ...DRAFT, tokens: PUBLISHED.tokens },
      changed: ['templates'],
    });
    const { sent } = renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), {
        [`PUT ${TH}`]: json(after, 200, { etag: '"d2"' }),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Revert to published' });
    await user.click(within(panel).getByRole('button', { name: 'Revert this tab to published' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'PUT')).toBe(true);
    });
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({
      tokens: PUBLISHED.tokens,
      assets: {},
      stylesheet: '.a { }',
      templates: { 'sign-in': TEMPLATE },
    });
    expect(await within(await bar()).findByText('Changed: Page templates')).toBeVisible();
  });

  it('clears the tab’s parts when nothing is published', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      PAGES,
      brandingRoutes(
        themeAnswer(
          twoTabs({ published: null, changed: ['tokens', 'stylesheet', 'templates'] }),
          '"d1"',
        ),
        { [`PUT ${TH}`]: json(themeView(), 200) },
      ),
    );
    const panel = await screen.findByRole('region', { name: 'Revert to published' });
    await user.click(within(panel).getByRole('button', { name: 'Revert this tab to published' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'PUT')).toBe(true);
    });
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ ...DRAFT, templates: {} });
  });

  it('is held when the tab has nothing to take back, and says so', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(twoTabs({ changed: ['templates'] }), '"d1"')));
    const panel = await screen.findByRole('region', { name: 'Revert to published' });
    expect(
      within(panel).getByRole('button', { name: 'Revert this tab to published' }),
    ).toBeDisabled();
    expect(within(panel).getByRole('note')).toHaveTextContent(
      'This tab already matches what is published.',
    );
  });

  it('is held while the tab has unsaved edits', async () => {
    const user = userEvent.setup();
    renderConsoleAt(PAGES, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    const section = await screen.findByRole('region', { name: 'Page templates' });
    await user.click(within(section).getByRole('textbox', { name: 'Sign in: template' }));
    await user.paste('x');
    const panel = screen.getByRole('region', { name: 'Revert to published' });
    expect(
      within(panel).getByRole('button', { name: 'Revert this tab to published' }),
    ).toBeDisabled();
    expect(within(panel).getByRole('note')).toHaveTextContent(
      'Save your changes first, in “Page templates”',
    );
  });

  it('says so under the button when the draft has moved on, and writes nothing else', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      PAGES,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), {
        [`PUT ${TH}`]: problem(412, 'about:blank', 'Precondition Failed'),
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Revert to published' });
    await user.click(within(panel).getByRole('button', { name: 'Revert this tab to published' }));
    expect(await within(panel).findByText(/Somebody saved the draft/u)).toBeVisible();
    expect(sent.filter((s) => s.method !== 'GET')).toHaveLength(1);
  });
});

describe('a revert that met a newer draft', () => {
  const REVERT_BUTTON = 'Revert this tab to published';
  const CONFLICT = /Changed in the Pages tab since you opened it/u;

  async function refused() {
    const user = userEvent.setup();
    const put = inTurn(problem(412, 'about:blank', 'Precondition Failed'), json(twoTabs()));
    const rendered = renderConsoleAt(
      PAGES,
      brandingRoutes(inTurn(themeAnswer(twoTabs(), '"d1"'), themeAnswer(twoTabs(), '"d2"')), {
        [`PUT ${TH}`]: put,
      }),
    );
    const panel = await screen.findByRole('region', { name: 'Revert to published' });
    await user.click(within(panel).getByRole('button', { name: REVERT_BUTTON }));
    return { user, sent: rendered.sent, panel };
  }

  it('shows the draft beside what the revert writes, on the shared panel', async () => {
    const { panel } = await refused();
    expect(await within(panel).findByText(CONFLICT)).toBeVisible();
    const table = within(panel).getByRole('table', { name: CONFLICT });
    expect(within(table).getByText('Page templates')).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Keep mine in the Pages tab' })).toBeEnabled();
  });

  it('writes the revert again on the newer tag when I keep mine', async () => {
    const { user, sent, panel } = await refused();
    await user.click(
      await within(panel).findByRole('button', { name: 'Keep mine in the Pages tab' }),
    );
    await waitFor(() => {
      expect(sent.filter((s) => s.method === 'PUT')).toHaveLength(2);
    });
    expect(sent.filter((s) => s.method === 'PUT')[1]?.ifMatch).toBe('"d2"');
    await waitFor(() => {
      expect(screen.queryByText(CONFLICT)).toBeNull();
    });
  });

  it('leaves the draft as it is when I take theirs', async () => {
    const { user, sent, panel } = await refused();
    await user.click(
      await within(panel).findByRole('button', { name: 'Take theirs in the Pages tab' }),
    );
    await waitFor(() => {
      expect(screen.queryByText(CONFLICT)).toBeNull();
    });
    expect(sent.filter((s) => s.method === 'PUT')).toHaveLength(1);
    expect(within(panel).queryByText(/Somebody saved the draft/u)).toBeNull();
  });
});

describe('while a write is running or edits are unsaved', () => {
  const REVERT = 'Revert this tab to published';

  it('holds Discard, Revert and the menu items while a publish is in flight, naming it', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      PAGES,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), { [`POST ${TH}/publish`]: pending() }),
    );
    const region = await bar();
    await user.click(await within(region).findByRole('button', { name: 'Publish the draft' }));
    await waitFor(() => {
      expect(within(region).getByRole('button', { name: 'Discard draft…' })).toBeDisabled();
    });
    expect(within(region).getAllByText('Publishing…').length).toBeGreaterThan(0);
    const panel = screen.getByRole('region', { name: 'Revert to published' });
    expect(within(panel).getByRole('button', { name: REVERT })).toBeDisabled();
    expect(within(panel).getByRole('note')).toHaveTextContent('Publishing…');
    await user.click(within(region).getByRole('button', { name: 'More publishing actions' }));
    const menu = await screen.findByRole('menu');
    for (const item of within(menu).getAllByRole('menuitem')) {
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item).toHaveTextContent('Publishing…');
    }
  });

  it('holds Publish and Revert while a discard is in flight, and Discard cannot be pressed twice', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      PAGES,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), { [`DELETE ${TH}/draft`]: pending() }),
    );
    const region = await bar();
    await user.click(await within(region).findByRole('button', { name: 'Discard draft…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
    await waitFor(() => {
      expect(
        within(region).getByRole('button', { name: 'Publish the draft', hidden: true }),
      ).toBeDisabled();
    });
    expect(
      within(region).getAllByText('Discarding…', { ignore: '[hidden]' }).length,
    ).toBeGreaterThan(0);
    expect(
      within(screen.getByRole('region', { name: 'Revert to published', hidden: true })).getByRole(
        'button',
        { name: REVERT, hidden: true },
      ),
    ).toBeDisabled();
    expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
  });

  it('keeps Discard held once a publish has consumed the draft', async () => {
    const user = userEvent.setup();
    const consumed = themeView({ draft: null, published: published(), changed: [] });
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), {
        [`POST ${TH}/publish`]: json({ ...consumed, warnings: [] }),
      }),
    );
    const region = await bar();
    await user.click(await within(region).findByRole('button', { name: 'Publish the draft' }));
    await waitFor(() => {
      expect(within(region).getByRole('button', { name: 'Discard draft…' })).toBeDisabled();
    });
    await user.click(within(region).getByRole('button', { name: 'More publishing actions' }));
    const item = await screen.findByRole('menuitem', { name: /Discard draft/u });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent('There is no draft to discard.');
  });

  it('holds Discard while a section has unsaved edits, and says to save or discard them', async () => {
    const user = userEvent.setup();
    renderConsoleAt(PAGES, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    const section = await screen.findByRole('region', { name: 'Page templates' });
    await user.click(within(section).getByRole('textbox', { name: 'Sign in: template' }));
    await user.paste('x');
    const region = await bar();
    expect(within(region).getByRole('button', { name: 'Discard draft…' })).toBeDisabled();
    expect(within(region).getByText(/^Save or discard your changes first/u)).toBeVisible();
  });

  it('holds Publish, Discard and Revert while an image upload is in flight, naming it Saving', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), { [`POST ${TH}/assets`]: pending() }),
    );
    const images = await screen.findByRole('region', { name: 'Images' });
    const input = images.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('no file input');
    await user.upload(
      input,
      new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }),
    );
    const region = await bar();
    await waitFor(() => {
      expect(within(region).getByRole('button', { name: 'Publish the draft' })).toBeDisabled();
    });
    expect(within(region).getAllByText('Saving…').length).toBeGreaterThan(0);
    expect(within(region).getByRole('button', { name: 'Discard draft…' })).toBeDisabled();
    expect(
      within(screen.getByRole('region', { name: 'Revert to published' })).getByRole('button', {
        name: 'Revert this tab to published',
      }),
    ).toBeDisabled();
  });

  it('has nothing axe can find in either theme while a publish is in flight', async () => {
    const user = userEvent.setup();
    const { element } = consoleAt(
      PAGES,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), { [`POST ${TH}/publish`]: pending() }),
    );
    const found = await axeInBothThemes(
      () => element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Publish the draft' }));
        await screen.findAllByText('Publishing…');
      },
      { frames: false },
    );
    expect(found).toEqual({ light: [], dark: [] });
  });
});

describe('the folded bar', () => {
  const more = async () =>
    within(await bar()).findByRole('button', { name: 'More publishing actions' });

  it('says what is waiting as a count, and keeps the sentence for a title', async () => {
    renderConsoleAt(AT, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    const count = await within(await bar()).findByText('2 changes');
    expect(count).toHaveAttribute('title', 'Changed: Colours and font, Page templates');
  });

  it('offers Revert for the tab shown and Discard, by arrow keys', async () => {
    const user = userEvent.setup();
    renderConsoleAt(PAGES, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    await user.click(await more());
    const menu = await screen.findByRole('menu', { name: 'More publishing actions' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Revert this tab to published', 'Discard draft…']);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Discard draft…' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Discard the draft?');
  });

  it('asks before Discard from the menu, and Cancel gives focus back to the menu button', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(PAGES, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    const trigger = await more();
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Discard draft…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
    expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
  });

  it('reverts the Pages tab from the menu, as its own panel does', async () => {
    const user = userEvent.setup();
    const after = twoTabs({ draft: { ...DRAFT, templates: {} }, changed: ['tokens'] });
    const { sent } = renderConsoleAt(
      PAGES,
      brandingRoutes(themeAnswer(twoTabs(), '"d1"'), {
        [`PUT ${TH}`]: json(after, 200, { etag: '"d2"' }),
      }),
    );
    await user.click(await more());
    await user.click(await screen.findByRole('menuitem', { name: 'Revert this tab to published' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'PUT')).toBe(true);
    });
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ ...DRAFT, templates: {} });
  });

  it('says why Revert is held, under it', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(twoTabs({ changed: ['templates'] }), '"d1"')));
    await user.click(await more());
    const item = await screen.findByRole('menuitem', { name: /Revert this tab to published/u });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent('This tab already matches what is published.');
  });

  it('offers Revert on no tab that has nothing to take back', async () => {
    const user = userEvent.setup();
    renderConsoleAt(`${AT}?tab=mail`, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    await user.click(await more());
    const menu = await screen.findByRole('menu', { name: 'More publishing actions' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Discard draft…']);
  });
});

describe('states', () => {
  it('shows the bar nowhere while the theme loads or fails to load', async () => {
    renderConsoleAt(AT, brandingRoutes(problem(500)));
    await screen.findByText(/could not be loaded/u);
    expect(screen.queryByRole('region', { name: 'Publish' })).toBeNull();
  });

  it('has nothing axe can find in either theme, on the Theme tab and on the Pages tab', async () => {
    const theme = consoleAt(AT, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    expect(
      await axeInBothThemes(
        () => theme.element,
        () => screen.findByRole('region', { name: 'Revert to published' }),
        { frames: false },
      ),
    ).toEqual({ light: [], dark: [] });
    const pages = consoleAt(PAGES, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    expect(
      await axeInBothThemes(
        () => pages.element,
        () => screen.findByRole('region', { name: 'Revert to published' }),
        { frames: false },
      ),
    ).toEqual({ light: [], dark: [] });
  });

  it('is operable from the keyboard: Publish, Discard, then the tabs', async () => {
    const user = userEvent.setup();
    renderConsoleAt(AT, brandingRoutes(themeAnswer(twoTabs(), '"d1"')));
    await bar();
    const publish = screen.getByRole('button', { name: 'Publish the draft' });
    publish.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Discard draft…' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });
});
