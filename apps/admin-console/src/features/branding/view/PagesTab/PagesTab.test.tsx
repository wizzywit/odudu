import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { brandingRoutes, draftedView, EMPTY, TH, themeAnswer } from '#/testing/brandingFixtures';
import { json, problem } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/branding?tab=pages';

it('says which layer supplies the page’s layout, and that an empty one uses the layer below', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await screen.findByRole('region', { name: 'Page templates' });
  expect(
    within(section).getByText(/Draft: Instrument’s default · Published: Instrument’s default\./u),
  ).toBeVisible();
  expect(within(section).getByText(/Empty uses the layer below\./u)).toBeVisible();
});

it('shows the required parts of the sign-in page, and what it may not hold', async () => {
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const parts = await screen.findByRole('region', { name: 'Parts of this page' });
  for (const part of ['form.open', 'fields', 'submit', 'error', 'form.close']) {
    expect(within(parts).getByText(`{{${part}}}`)).toBeVisible();
  }
  expect(within(parts).getByText(/Scripts, styles, forms/u)).toBeVisible();
});

it('folds the parts of a page under their heading, closed until it is pressed', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const parts = await screen.findByRole('region', { name: 'Parts of this page' });
  const fold = within(parts).getByRole('button', { name: 'Parts of this page' });
  expect(fold).toHaveAttribute('aria-expanded', 'false');
  const body = document.getElementById(fold.getAttribute('aria-controls') ?? '');
  expect(body).toHaveAttribute('data-collapsed');
  await user.click(fold);
  expect(fold).toHaveAttribute('aria-expanded', 'true');
  expect(body).not.toHaveAttribute('data-collapsed');
});

it('edits the template in a code field, with its parts coloured and the lines numbered', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await screen.findByRole('region', { name: 'Page templates' });
  const box = within(section).getByRole('textbox', { name: 'Sign in: template' });
  await user.click(box);
  await user.paste('<p>{{intro}}</p>\n<p>{{fields}}</p>');
  expect(within(section).getByText('{{intro}}', { selector: 'pre span span' })).toBeVisible();
  const gutter = box.parentElement?.parentElement?.firstElementChild;
  expect(gutter?.textContent).toBe('1\n2');
  expect(within(section).getByText(/0 of 65,536 bytes|\d+ of 65,536 bytes/u)).toBeVisible();
  expect(box).toHaveAccessibleDescription(/Tab indents/u);
});

it('marks the line the server refused in a template, and lists why', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
      [`PUT ${TH}`]: problem(400, 'about:blank', 'Bad Request', {
        errors: [
          {
            path: 'templates.sign-in',
            message: 'The slot is not a part of this page kind.',
            code: 'unknown-slot',
            detail: 'nope',
            line: 2,
            column: 4,
          },
        ],
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Page templates' });
  await user.click(within(section).getByRole('textbox', { name: 'Sign in: template' }));
  await user.paste('<p>{{form.open}}</p>\n<p>{{nope}}</p>');
  await user.click(within(section).getByRole('button', { name: /Save/u }));
  expect(
    await within(section).findByText('Line 2: The slot is not a part of this page kind. (nope)'),
  ).toBeVisible();
  expect(within(section).getByText('The template was not saved.')).toBeVisible();
  const scroller = section.querySelector('textarea')?.parentElement?.parentElement;
  expect(scroller?.firstElementChild?.querySelectorAll('span')).toHaveLength(1);
});

it('marks the template line a refused publish names, on the Pages tab', async () => {
  const user = userEvent.setup();
  const view = draftedView();
  renderConsoleAt(
    '/console/acme/branding',
    brandingRoutes(
      themeAnswer(
        {
          ...view,
          draft: {
            ...EMPTY,
            templates: { 'sign-in': '<p>{{form.open}}</p>\n<p>{{nope}}</p>' },
          },
        },
        '"d1"',
      ),
      {
        [`POST ${TH}/publish`]: problem(400, 'about:blank', 'Bad Request', {
          errors: [
            {
              path: 'templates.sign-in',
              message: 'The slot is not a part of this page kind.',
              code: 'unknown-slot',
              detail: 'nope',
              line: 2,
              column: 4,
            },
          ],
        }),
      },
    ),
  );
  await user.click(await screen.findByRole('button', { name: 'Publish the draft' }));
  await user.click(await screen.findByRole('tab', { name: /Pages/u }));
  const section = await screen.findByRole('region', { name: 'Page templates' });
  expect(
    await within(section).findByText('Line 2: The slot is not a part of this page kind. (nope)'),
  ).toBeVisible();
  expect(within(section).getByText('The saved template was refused at publish.')).toBeVisible();
  await user.type(within(section).getByRole('textbox', { name: 'Sign in: template' }), 'x');
  expect(within(section).queryByText(/Line 2:/u)).toBeNull();
});

it('drops a refusal from the Publish panel once the draft it refused is replaced', async () => {
  const user = userEvent.setup();
  const view = draftedView();
  const bad = { ...EMPTY, templates: { 'sign-in': '<p>{{form.open}}</p>\n<p>{{nope}}</p>' } };
  const fixed = { ...view, draft: { ...EMPTY, templates: { 'sign-in': '<p>{{form.open}}</p>' } } };
  renderConsoleAt(
    '/console/acme/branding',
    brandingRoutes(themeAnswer({ ...view, draft: bad }, '"d1"'), {
      [`POST ${TH}/publish`]: problem(400, 'about:blank', 'Bad Request', {
        errors: [{ path: 'templates.sign-in', message: 'Unknown slot.', line: 2, column: 4 }],
      }),
      [`PUT ${TH}`]: json(fixed, 200, { etag: '"d2"' }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Publish the draft' }));
  const panel = await screen.findByRole('region', { name: 'Publish' });
  expect(await within(panel).findByText(/templates\.sign-in: Unknown slot\./u)).toBeVisible();
  await user.click(screen.getByRole('tab', { name: /Pages/u }));
  const section = await screen.findByRole('region', { name: 'Page templates' });
  await user.click(within(section).getByRole('textbox', { name: 'Sign in: template' }));
  await user.keyboard('{Backspace>9/}');
  await user.click(within(section).getByRole('button', { name: /Save/u }));
  await waitFor(() => {
    expect(within(section).queryByRole('button', { name: /Save/u })).toBeNull();
  });
  await user.click(screen.getByRole('tab', { name: /Theme/u }));
  const again = await screen.findByRole('region', { name: 'Publish' });
  expect(within(again).queryByText(/templates\.sign-in/u)).toBeNull();
});

it('does not carry one page’s undo history to another page with the same text', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await screen.findByRole('region', { name: 'Page templates' });
  const box = within(section).getByRole('textbox', { name: 'Sign in: template' });
  await user.click(box);
  await user.keyboard('x');
  await user.keyboard('{Backspace}');
  expect(box).toHaveValue('');
  await user.selectOptions(within(section).getByRole('combobox', { name: 'Page' }), 'Consent');
  const other = within(section).getByRole('textbox', { name: 'Consent: template' });
  await user.click(other);
  await user.keyboard('{Control>}z{/Control}');
  expect(other).toHaveValue('');
});

it('inserts a message of the page’s own catalogue at the caret, saved like any edit', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await screen.findByRole('region', { name: 'Page templates' });
  const box = within(section).getByRole('textbox', { name: 'Sign in: template' });
  await user.click(box);
  await user.paste('<h1></h1>{{form.open}}');
  (box as HTMLTextAreaElement).setSelectionRange(4, 4);
  const picker = await within(section).findByRole('combobox', { name: 'Insert a message' });
  await user.type(picker, 'Sign in to');
  await user.click(await screen.findByRole('option', { name: /login\.title/u }));
  expect(box).toHaveValue('<h1>{{t "login.title"}}</h1>{{form.open}}');
  expect(within(section).getByRole('button', { name: /Save/u })).toBeEnabled();
});

it('offers only the messages of the page kind being edited', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const section = await screen.findByRole('region', { name: 'Page templates' });
  await user.click(
    await within(section).findByRole('button', { name: /^Show Insert a message options/u }),
  );
  const own = (await screen.findAllByRole('option')).map((o) => o.textContent);
  expect(own.some((text) => text.startsWith('login.title'))).toBe(true);
  expect(own.some((text) => text.startsWith('register.title'))).toBe(false);
  await user.keyboard('{Escape}');
  await user.selectOptions(within(section).getByRole('combobox', { name: 'Page' }), 'Registration');
  await user.click(
    await within(section).findByRole('button', { name: /^Show Insert a message options/u }),
  );
  const other = (await screen.findAllByRole('option')).map((o) => o.textContent);
  expect(other.some((text) => text.startsWith('register.title'))).toBe(true);
  expect(other.some((text) => text.startsWith('login.title'))).toBe(false);
});

it('has nothing axe can find in either theme', async () => {
  const { element } = consoleAt(AT, brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const found = await axeInBothThemes(
    () => element,
    () => screen.findByRole('region', { name: 'Parts of this page' }),
    { frames: false },
  );
  expect(found).toEqual({ light: [], dark: [] });
});
