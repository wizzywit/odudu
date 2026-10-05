import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { G, groupRoutes, PLATFORM } from '#/testing/groupsFixtures.ts';
import { consoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

it("announces a section's refusal in one line, and passes axe in both themes", async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          '/console/acme/groups/g-plat',
          groupRoutes(undefined, {
            [`GET ${G}/g-plat`]: json(PLATFORM, 200, { etag: '"p1"' }),
            [`PUT ${G}/g-plat/default`]: problem(403, 'about:blank', 'Forbidden', {
              detail:
                'a group every new subject joins may reach no admin capability, and this one would reach: view-users',
            }),
          }),
        ).element,
      async () => {
        const section = await screen.findByRole('region', { name: 'New subjects' });
        await user.click(
          await within(section).findByRole('switch', { name: 'Joined by every new subject' }),
        );
        await user.click(within(section).getByRole('button', { name: 'Save New subjects' }));
        const said = await within(section).findByRole('status');
        await within(said).findByText(/may reach no admin capability/u);
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
