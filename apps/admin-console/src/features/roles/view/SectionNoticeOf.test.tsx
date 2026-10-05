import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { inTurn, json, problem } from '#/testing/fakeTransport.ts';
import { AUDITOR, R, roleRoutes } from '#/testing/rolesFixtures.ts';
import { consoleAt, resetConsole } from '#/testing/renderConsole.tsx';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

it('shows a description changed elsewhere beside yours, and passes axe in both themes', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          '/console/acme/roles/r-aud',
          roleRoutes(undefined, {
            [`GET ${R}/r-aud`]: inTurn(
              json(AUDITOR, 200, { etag: '"a1"' }),
              json({ ...AUDITOR, description: 'Theirs' }, 200, { etag: '"a2"' }),
            ),
            [`PATCH ${R}/r-aud`]: problem(412, 'about:blank', 'Precondition Failed'),
          }),
        ).element,
      async () => {
        const section = await screen.findByRole('region', { name: 'Description' });
        const field = within(section).getByRole('textbox', { name: 'Description' });
        await user.clear(field);
        await user.type(field, 'Mine');
        await user.click(within(section).getByRole('button', { name: 'Save Description' }));
        await within(section).findByRole('button', { name: 'Keep mine in Description' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
