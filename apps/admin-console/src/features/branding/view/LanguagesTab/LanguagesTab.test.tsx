import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { OVER_BOUND, UNKNOWN_KEY } from '#/features/branding/service';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { HELP_OVERRIDE, languagesRoutes, MC, MO, TITLE_OVERRIDE } from '#/testing/brandingFixtures';
import { inTurn, json, problem } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';
import { settingsAnswer, ST } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding?tab=languages';
const PUT_TITLE = `PUT ${MO}/en/login.title`;

async function typeOverride(user: ReturnType<typeof userEvent.setup>, key: string, text: string) {
  await user.type(await screen.findByRole('combobox', { name: /Message key/u }), key);
  await user.type(screen.getByRole('textbox', { name: /Text shown instead/u }), text);
}

it('lists the overrides of the opening language, asking for a bounded page', async () => {
  const { sent } = renderConsoleAt(AT, languagesRoutes());
  const table = await screen.findByRole('grid', { name: 'Message overrides' });
  expect(within(table).getByRole('row', { name: /login\.title/u })).toHaveTextContent(
    'Welcome back',
  );
  const read = sent.find((request) => request.path === MO);
  expect(read?.search.get('locale')).toBe('en');
  expect(Number(read?.search.get('limit'))).toBeLessThanOrEqual(200);
});

it('opens on the tenant’s default language and offers only the supported ones', async () => {
  const { sent } = renderConsoleAt(
    AT,
    languagesRoutes({}, { supported_locales: ['en', 'ar'], default_locale: 'ar' }),
  );
  await screen.findByRole('grid', { name: 'Message overrides' });
  expect(sent.find((request) => request.path === MO)?.search.get('locale')).toBe('ar');
});

it('says when a language has no override', async () => {
  renderConsoleAt(AT, languagesRoutes({ [`GET ${MO}`]: json({ items: [] }) }));
  expect(await screen.findByText('No overrides yet')).toBeVisible();
});

it('pages through a language a page at a time', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    languagesRoutes({
      [`GET ${MO}`]: (request) =>
        json(
          request.search.get('cursor') === null
            ? { items: [TITLE_OVERRIDE], next: 'c2' }
            : { items: [HELP_OVERRIDE] },
        )(request),
    }),
  );
  await screen.findByRole('grid', { name: 'Message overrides' });
  await user.click(await screen.findByRole('button', { name: 'Load more overrides' }));
  await waitFor(() => {
    expect(
      sent.some((request) => request.path === MO && request.search.get('cursor') === 'c2'),
    ).toBe(true);
  });
  expect(await screen.findByRole('row', { name: /login\.help/u })).toBeVisible();
});

it('refuses a key not in en with its wording', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    languagesRoutes({
      [`PUT ${MO}/en/no.such.key`]: problem(400, 'about:blank', 'Bad Request', {
        detail: 'key: is not the key of any page or mail message',
        errors: [{ path: 'key', message: 'is not the key of any page or mail message' }],
      }),
    }),
  );
  await typeOverride(user, 'no.such.key', 'Hello');
  await user.click(screen.getByRole('button', { name: 'Save override' }));
  const key = await screen.findByRole('combobox', { name: /Message key/u });
  await waitFor(() => {
    expect(key).toBeInvalid();
  });
  expect(screen.getByText(UNKNOWN_KEY)).toBeVisible();
  expect(sent.find((request) => request.method === 'PUT')?.body).toEqual({ message: 'Hello' });
});

it('says the tenant is full when the server refuses a new override', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    languagesRoutes({
      [PUT_TITLE]: problem(409, 'about:blank#message-overrides-full', 'Conflict', {
        detail: 'the tenant already holds 500 message overrides',
      }),
    }),
  );
  await typeOverride(user, 'login.title', 'Hello');
  await user.click(screen.getByRole('button', { name: 'Save override' }));
  expect(await screen.findByText(OVER_BOUND)).toBeVisible();
});

it('asks for a key and a text before sending anything', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, languagesRoutes());
  await screen.findByRole('grid', { name: 'Message overrides' });
  await user.click(screen.getByRole('button', { name: 'Save override' }));
  expect(await screen.findByText(/Enter the key/u)).toBeVisible();
  expect(screen.getByText(/Enter the text/u)).toBeVisible();
  expect(sent.some((request) => request.method === 'PUT')).toBe(false);
});

it('sets an override, empties the form and reads the list again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    languagesRoutes({
      [PUT_TITLE]: json({ ...TITLE_OVERRIDE, message: 'Hello' }),
      [`GET ${MO}`]: inTurn(
        json({ items: [HELP_OVERRIDE] }),
        json({ items: [{ ...TITLE_OVERRIDE, message: 'Hello' }, HELP_OVERRIDE] }),
      ),
    }),
  );
  await typeOverride(user, 'login.title', 'Hello');
  await user.click(screen.getByRole('button', { name: 'Save override' }));
  expect(await screen.findByRole('row', { name: /login\.title/u })).toHaveTextContent('Hello');
  expect(screen.getByRole('combobox', { name: /Message key/u })).toHaveValue('');
  expect(sent.find((request) => request.method === 'PUT')?.path).toBe(`${MO}/en/login.title`);
});

it('edits an override by filling the form with it, and saves the new text', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    languagesRoutes({ [PUT_TITLE]: json({ ...TITLE_OVERRIDE, message: 'Hi' }) }),
  );
  await user.click(await screen.findByRole('button', { name: 'Edit login.title' }));
  const text = screen.getByRole('textbox', { name: /Text shown instead/u });
  expect(screen.getByRole('combobox', { name: /Message key/u })).toHaveValue('login.title');
  expect(text).toHaveValue('Welcome back');
  await user.clear(text);
  await user.type(text, 'Hi');
  await user.click(screen.getByRole('button', { name: 'Save override' }));
  await waitFor(() => {
    expect(sent.find((request) => request.method === 'PUT')?.body).toEqual({ message: 'Hi' });
  });
});

it('removes an override once confirmed, and says what it did', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    languagesRoutes({
      [`DELETE ${MO}/en/login.title`]: () => new Response(null, { status: 204 }),
      [`GET ${MO}`]: inTurn(
        json({ items: [TITLE_OVERRIDE, HELP_OVERRIDE] }),
        json({ items: [HELP_OVERRIDE] }),
      ),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Remove login.title' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Remove this override?' });
  expect(dialog).toHaveTextContent('catalogue’s text for login.title');
  await user.click(within(dialog).getByRole('button', { name: 'Remove override' }));
  expect(await screen.findByRole('status', { name: 'Last removal' })).toHaveTextContent(
    'was removed',
  );
  expect(sent.some((request) => request.method === 'DELETE')).toBe(true);
  await waitFor(() => {
    expect(screen.queryByRole('row', { name: /login\.title/u })).toBeNull();
  });
});

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

it('does not give the loaded rows as the total while more pages follow', async () => {
  renderConsoleAt(
    AT,
    languagesRoutes({ [`GET ${MO}`]: json({ items: [TITLE_OVERRIDE], next: 'c2' }) }),
  );
  expect(await screen.findByText(/1 override loaded so far; more follow/u)).toBeVisible();
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

it('offers the keys the server holds, with their text, and keeps a key typed whole', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, languagesRoutes());
  const key = await screen.findByRole('combobox', { name: /Message key/u });
  await user.click(screen.getByRole('button', { name: /^Show Message key options/u }));
  const options = await screen.findAllByRole('option');
  expect(options.length).toBeGreaterThan(0);
  expect(options.length).toBeLessThanOrEqual(50);
  await user.type(key, 'Create an acc');
  expect(await screen.findByRole('option', { name: /register\.title/u })).toHaveTextContent(
    'Create an account',
  );
});

it('still takes a typed key when the list of messages cannot be read', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    languagesRoutes({ [`GET ${MC}`]: problem(500, 'about:blank', 'Internal Server Error') }),
  );
  const key = await screen.findByRole('combobox', { name: /Message key/u });
  expect(await screen.findByText('The list of messages could not be loaded.')).toBeVisible();
  await user.type(key, 'login.title');
  expect(key).toHaveValue('login.title');
});

describe('two administrators and one override', () => {
  const stale = problem(412, 'about:blank', 'Precondition Failed');
  const THEIRS = { ...TITLE_OVERRIDE, message: 'Their wording', etag: '"theirs"' };

  async function editTitle(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(await screen.findByRole('button', { name: 'Edit login.title' }));
    const field = screen.getByRole('textbox', { name: /Text shown instead/u });
    await user.clear(field);
    await user.type(field, text);
    await user.click(screen.getByRole('button', { name: 'Save override' }));
  }

  it('creates under If-None-Match, changes and removes under the version the row showed', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      languagesRoutes({
        [PUT_TITLE]: json({ ...TITLE_OVERRIDE, message: 'Hi' }),
        [`PUT ${MO}/en/login.new`]: json({ ...TITLE_OVERRIDE, key: 'login.new' }),
        [`DELETE ${MO}/en/login.help`]: () => new Response(null, { status: 204 }),
      }),
    );
    await editTitle(user, 'Hi');
    await waitFor(() => {
      expect(sent.find((request) => request.path === `${MO}/en/login.title`)?.ifMatch).toBe(
        TITLE_OVERRIDE.etag,
      );
    });
    await typeOverride(user, 'login.new', 'Fresh');
    await user.click(screen.getByRole('button', { name: 'Save override' }));
    await waitFor(() => {
      expect(sent.find((request) => request.path === `${MO}/en/login.new`)).toMatchObject({
        ifNoneMatch: '*',
        ifMatch: null,
      });
    });
    await user.click(await screen.findByRole('button', { name: 'Remove login.help' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this override?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove override' }));
    await waitFor(() => {
      expect(sent.find((request) => request.method === 'DELETE')?.ifMatch).toBe(HELP_OVERRIDE.etag);
    });
  });

  it('shows the conflict on that override, keeps the other rows editable, and keeps mine on theirs version', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      languagesRoutes({
        [PUT_TITLE]: inTurn(stale, json({ ...TITLE_OVERRIDE, message: 'Mine', etag: '"mine"' })),
        [`GET ${MO}`]: (request) =>
          json({
            items:
              request.search.get('limit') === '200'
                ? [THEIRS, HELP_OVERRIDE]
                : [TITLE_OVERRIDE, HELP_OVERRIDE],
          })(request),
      }),
    );
    await editTitle(user, 'Mine');
    const panel = await screen.findByText(
      'Changed in the en text for login.title since you opened it',
    );
    expect(panel).toBeVisible();
    const table = screen.getByRole('table', { name: /Changed in the en text for login\.title/u });
    expect(within(table).getByText('Their wording')).toBeVisible();
    expect(within(table).getByText('Mine')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit login.help' })).toBeEnabled();
    await user.click(
      screen.getByRole('button', { name: 'Keep mine in the en text for login.title' }),
    );
    await waitFor(() => {
      expect(screen.queryByText(/Changed in the en text for login\.title/u)).toBeNull();
    });
    const puts = sent.filter((request) => request.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(puts[1]).toMatchObject({ ifMatch: '"theirs"', body: { message: 'Mine' } });
  });

  it('drops my edit and the form holding it when I take theirs', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      languagesRoutes({
        [PUT_TITLE]: stale,
        [`GET ${MO}`]: (request) =>
          json({ items: request.search.get('limit') === '200' ? [THEIRS] : [TITLE_OVERRIDE] })(
            request,
          ),
      }),
    );
    await editTitle(user, 'Mine');
    await user.click(
      await screen.findByRole('button', { name: 'Take theirs in the en text for login.title' }),
    );
    await waitFor(() => {
      expect(screen.queryByText(/Changed in the en text for login\.title/u)).toBeNull();
    });
    expect(screen.getByRole('combobox', { name: /Message key/u })).toHaveValue('');
    expect(sent.filter((request) => request.method === 'PUT')).toHaveLength(1);
  });

  it('offers to create it again when the other administrator removed the override', async () => {
    const user = userEvent.setup();
    const { sent } = renderConsoleAt(
      AT,
      languagesRoutes({
        [PUT_TITLE]: inTurn(stale, json({ ...TITLE_OVERRIDE, message: 'Mine' })),
        [`GET ${MO}`]: (request) =>
          json({ items: request.search.get('limit') === '200' ? [] : [TITLE_OVERRIDE] })(request),
      }),
    );
    await editTitle(user, 'Mine');
    await user.click(
      await screen.findByRole('button', { name: 'Keep mine in the en text for login.title' }),
    );
    await waitFor(() => {
      expect(sent.filter((request) => request.method === 'PUT')).toHaveLength(2);
    });
    expect(sent.filter((request) => request.method === 'PUT')[1]).toMatchObject({
      ifNoneMatch: '*',
      ifMatch: null,
    });
  });

  it('closes the dialog on a stale removal, says so over the refreshed list, and removes on the next try', async () => {
    const user = userEvent.setup();
    const FRESH = { ...TITLE_OVERRIDE, message: 'Changed meanwhile', etag: '"fresh"' };
    const { sent } = renderConsoleAt(
      AT,
      languagesRoutes({
        [`DELETE ${MO}/en/login.title`]: (request) =>
          request.ifMatch === '"fresh"' ? new Response(null, { status: 204 }) : stale(request),
        [`GET ${MO}`]: inTurn(
          json({ items: [TITLE_OVERRIDE, HELP_OVERRIDE] }),
          json({ items: [FRESH, HELP_OVERRIDE] }),
          json({ items: [HELP_OVERRIDE] }),
        ),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Remove login.title' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this override?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove override' }));
    expect(await screen.findByRole('status', { name: 'Last removal' })).toHaveTextContent(
      /changed after you saw it/u,
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByRole('row', { name: /login\.title/u })).toHaveTextContent(
      'Changed meanwhile',
    );
    await user.click(screen.getByRole('button', { name: 'Remove login.title' }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Remove this override?' })).getByRole(
        'button',
        { name: 'Remove override' },
      ),
    );
    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /login\.title/u })).toBeNull();
    });
    expect(sent.filter((request) => request.method === 'DELETE').map((r) => r.ifMatch)).toEqual([
      TITLE_OVERRIDE.etag,
      '"fresh"',
    ]);
  });

  it('words a removal by the other administrator as that, not as newer text', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      languagesRoutes({
        [PUT_TITLE]: stale,
        [`GET ${MO}`]: (request) =>
          json({ items: request.search.get('limit') === '200' ? [] : [TITLE_OVERRIDE] })(request),
      }),
    );
    await editTitle(user, 'Mine');
    expect(await screen.findByText(/Somebody else removed this override/u)).toBeVisible();
    const table = screen.getByRole('table', { name: /Changed in the en text for login\.title/u });
    expect(within(table).getByText('removed')).toBeVisible();
  });

  it('says so when the newer text cannot be read after a refusal', async () => {
    const user = userEvent.setup();
    renderConsoleAt(
      AT,
      languagesRoutes({
        [PUT_TITLE]: stale,
        [`GET ${MO}`]: (request) =>
          request.search.get('limit') === '200'
            ? problem(500, 'about:blank', 'Server error')(request)
            : json({ items: [TITLE_OVERRIDE] })(request),
      }),
    );
    await editTitle(user, 'Mine');
    expect(await screen.findByText(/newer text could not be loaded/u)).toBeVisible();
    expect(screen.queryByText(/Changed in the en text/u)).toBeNull();
  });

  it('takes a second press of Save during the read after a refusal for no second save', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sent } = renderConsoleAt(
      AT,
      languagesRoutes({
        [PUT_TITLE]: stale,
        [`GET ${MO}`]: async (request) => {
          if (request.search.get('limit') === '200') await held;
          return json({ items: [TITLE_OVERRIDE] })(request);
        },
      }),
    );
    await editTitle(user, 'Mine');
    const save = await screen.findByRole('button', { name: /Saving…|Save override/u });
    await waitFor(() => {
      expect(save).toBeDisabled();
    });
    await user.click(save);
    release();
    await screen.findByText(/Changed in the en text for login\.title/u);
    expect(sent.filter((request) => request.method === 'PUT')).toHaveLength(1);
  });

  it('has nothing axe can find in either theme with a conflict showing', async () => {
    const user = userEvent.setup();
    const { element } = consoleAt(
      AT,
      languagesRoutes({
        [PUT_TITLE]: stale,
        [`GET ${MO}`]: (request) =>
          json({ items: request.search.get('limit') === '200' ? [THEIRS] : [TITLE_OVERRIDE] })(
            request,
          ),
      }),
    );
    const found = await axeInBothThemes(
      () => element,
      async () => {
        await editTitle(user, 'Mine');
        await screen.findByText(/Changed in the en text for login\.title/u);
      },
      { frames: false },
    );
    expect(found).toEqual({ light: [], dark: [] });
  });
});
