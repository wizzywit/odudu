import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { C, clientRoutes } from '#/testing/clientsFixtures.ts';
import { problem } from '#/testing/fakeTransport.ts';
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
          '/console/acme/clients/c-bill',
          clientRoutes(undefined, {
            [`PATCH ${C}/c-bill`]: problem(403, 'about:blank', 'Forbidden', {
              detail: "the client's service account holds what the caller does not: manage-users",
            }),
          }),
        ).element,
      async () => {
        const section = await screen.findByRole('region', { name: 'Availability' });
        await user.click(await within(section).findByRole('switch', { name: 'Enabled' }));
        await user.click(within(section).getByRole('button', { name: 'Save Availability' }));
        const said = await within(section).findByRole('status');
        await within(said).findByText(/service account holds what the caller does not/u);
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
