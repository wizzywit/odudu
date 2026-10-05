import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { G, group, groupRoutes } from '#/testing/groupsFixtures.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/groups';
const MANY = group('g-many', '/eng/many', 'g-eng');

function children(answers: Parameters<typeof inTurn>) {
  const rest = inTurn(...answers);
  return {
    [`GET ${G}`]: (request: Parameters<typeof rest>[0]) =>
      request.search.get('parent') === 'g-eng'
        ? rest(request)
        : json({ items: [group('g-eng', '/eng'), group('g-fin', '/finance')] })(request),
  };
}

it('says a level could not be read, and reads it again when asked', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    groupRoutes(
      undefined,
      children([problem(500, 'about:blank', 'Oops'), json({ items: [MANY] })]),
    ),
  );
  const tree = await screen.findByRole('list', { name: 'Groups' });
  await user.click(within(tree).getByRole('button', { name: 'Show the groups under /eng' }));
  expect(await within(tree).findByText('The groups under /eng could not be loaded.')).toBeVisible();
  await user.click(within(tree).getByRole('button', { name: 'Try again' }));
  expect(await within(tree).findByRole('link', { name: 'many' })).toBeVisible();
});

it('pages a long level with Load more', async () => {
  const user = userEvent.setup();
  const MORE = group('g-more', '/eng/more', 'g-eng');
  renderConsoleAt(
    AT,
    groupRoutes(
      undefined,
      children([json({ items: [MANY], next: 'c1' }), json({ items: [MORE] })]),
    ),
  );
  const tree = await screen.findByRole('list', { name: 'Groups' });
  await user.click(within(tree).getByRole('button', { name: 'Show the groups under /eng' }));
  await user.click(
    await within(tree).findByRole('button', { name: 'Load more groups under /eng' }),
  );
  expect(await within(tree).findByRole('link', { name: 'more' })).toBeVisible();
});

it('passes axe in both themes with a level that failed', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(AT, groupRoutes(undefined, children([problem(500, 'about:blank', 'Oops')])))
          .element,
      async () => {
        const tree = await screen.findByRole('list', { name: 'Groups' });
        await user.click(within(tree).getByRole('button', { name: 'Show the groups under /eng' }));
        await within(tree).findByText('The groups under /eng could not be loaded.');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
