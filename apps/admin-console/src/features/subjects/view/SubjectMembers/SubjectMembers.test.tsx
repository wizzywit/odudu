import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADA, ADA_ID, S, subject } from '#/testing/subjectsFixtures.ts';
import { groupRoutes } from '#/testing/groupsFixtures.ts';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/groups/g-eng?tab=members';
const OFF = subject('s-linus', 'linus', { enabled: false });

it("lists a group's direct members, each opening its subject", async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    groupRoutes(undefined, {
      [`GET ${S}`]: json({ items: [ADA, OFF] }),
      [`GET ${S}/count`]: json({ count: 2, capped: false }),
    }),
  );
  const members = await screen.findByRole('grid', { name: 'Members of /eng' });
  expect(within(members).getByRole('row', { name: /linus/u })).toHaveTextContent('disabled');
  expect(sent.find((s) => s.path === S)?.search.get('group')).toBe('g-eng');
  expect(screen.getByText('2 members')).toBeVisible();
  expect(screen.getByText(/members of the groups beneath it are not listed/u)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open them in Subjects' })).toHaveAttribute(
    'href',
    '/console/acme/subjects?group=g-eng',
  );
  await user.click(within(members).getByRole('row', { name: /ada/u }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(`/acme/subjects/${ADA_ID}`);
  });
});

it('says reading members needs view-users, and sends no read whoami says is refused', async () => {
  const { sent } = renderConsoleAt(
    AT,
    groupRoutes(['manage-tenant'], { [`GET ${S}`]: problem(403, 'about:blank', 'Forbidden') }),
  );
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Members needs the view-users capability.',
  );
  expect(screen.queryByRole('link', { name: 'Open them in Subjects' })).toBeNull();
  expect(sent.some((s) => s.path === S)).toBe(false);
});

it('says a group has no members yet', async () => {
  renderConsoleAt(AT, groupRoutes());
  expect(await screen.findByText('Nobody belongs to /eng directly yet.')).toBeVisible();
});

it('passes axe in both themes, listed and refused', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(AT, groupRoutes(undefined, { [`GET ${S}`]: json({ items: [ADA, OFF] }) }))
          .element,
      () => screen.findByRole('grid', { name: 'Members of /eng' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          groupRoutes(['manage-tenant'], {
            [`GET ${S}`]: problem(403, 'about:blank', 'Forbidden'),
          }),
        ).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
