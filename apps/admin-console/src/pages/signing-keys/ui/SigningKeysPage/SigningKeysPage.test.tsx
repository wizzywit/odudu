import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, offline, pending, problem } from '#/testing/fakeTransport';
import {
  ACTIVE_KEY,
  KEYS,
  keyRoutes,
  lanes,
  READY_KEY,
  RETIRED_KEY,
  signingKey,
  YOUNG_KEY,
} from '#/testing/keysFixtures';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { expectRefusedThenCancelled } from '#/testing/refusedThenCancelled';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/keys';

async function lane(name: string) {
  return screen.findByRole('grid', { name });
}

it('lists the keys in three lanes by their stored status, each with its algorithm', async () => {
  renderConsoleAt(AT, keyRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Signing keys' })).toBeVisible();
  for (const name of ['Rotating', 'Active', 'Retired']) {
    expect(await screen.findByRole('heading', { level: 2, name })).toBeVisible();
  }
  expect(
    await within(await lane('Rotating keys')).findByRole('row', { name: /kid-k-ready/u }),
  ).toHaveTextContent('ES256');
  expect(
    within(await lane('Active keys')).getByRole('row', { name: /kid-k-active/u }),
  ).toBeVisible();
  expect(
    within(await lane('Retired keys')).getByRole('row', { name: /kid-k-retired/u }),
  ).toBeVisible();
  expect(screen.getByRole('status', { name: 'Last key action' })).not.toHaveFocus();
  expect(screen.getByRole('status', { name: 'Last stage' })).toBeEmptyDOMElement();
});

it('asks each lane for its own status, a page at a time', async () => {
  const { sent } = renderConsoleAt(AT, keyRoutes());
  await lane('Retired keys');
  const asked = sent.filter((s) => s.path === KEYS).map((s) => s.search.get('status'));
  expect(asked.sort()).toEqual(['active', 'retired', 'rotating']);
});

it('says an old rotating key is ready and a young one is not, with when it will be', async () => {
  renderConsoleAt(AT, keyRoutes(undefined, {}, [READY_KEY, YOUNG_KEY, ACTIVE_KEY]));
  const rotating = await lane('Rotating keys');
  expect(await within(rotating).findByRole('row', { name: /kid-k-ready/u })).toHaveTextContent(
    'Ready',
  );
  const young = within(rotating).getByRole('row', { name: /kid-k-young/u });
  expect(young).toHaveTextContent('Not ready');
  expect(young).toHaveTextContent(/Ready from \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/u);
});

it('offers no retire on the active key and says why, and no promote outside the rotating lane', async () => {
  renderConsoleAt(AT, keyRoutes());
  const active = within(await lane('Active keys')).getByRole('row', { name: /kid-k-active/u });
  expect(within(active).queryByRole('button')).toBeNull();
  expect(active).toHaveTextContent(/cannot be retired while it is active/u);
  expect(screen.queryByRole('button', { name: 'Promote kid-k-active' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Promote kid-k-retired' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retire kid-k-retired' })).toBeNull();
});

it('stages a key of the algorithm chosen and reads the lanes again', async () => {
  const user = userEvent.setup();
  const staged = signingKey('k-new', 'rotating', { alg: 'RS256' });
  const { sent } = renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`POST ${KEYS}`]: json(staged, 201),
      [`GET ${KEYS}`]: inTurn(
        lanes([ACTIVE_KEY]),
        lanes([ACTIVE_KEY]),
        lanes([ACTIVE_KEY]),
        lanes([staged, ACTIVE_KEY]),
      ),
    }),
  );
  await user.click(await screen.findByRole('button', { name: /Algorithm/u }));
  await user.click(await screen.findByRole('option', { name: /RS256/u }));
  await user.click(screen.getByRole('button', { name: 'Stage key' }));
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({ alg: 'RS256' });
  const toasts = await screen.findByRole('region', { name: 'Notifications' });
  expect(await within(toasts).findByText(/RS256 key, kid-k-new, was staged/u)).toBeVisible();
});

it('starts the algorithm from the active key’s', async () => {
  const rs = signingKey('k-rs', 'active', { alg: 'RS256' });
  renderConsoleAt(AT, keyRoutes(undefined, {}, [rs]));
  expect(await screen.findByRole('button', { name: /RS256 \(RSA\)/u })).toBeVisible();
});

it('says beside the button that a lost stage was not sent again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, keyRoutes(undefined, { [`POST ${KEYS}`]: offline() }));
  await user.click(await screen.findByRole('button', { name: 'Stage key' }));
  expect(await screen.findByRole('status', { name: 'Last stage' })).toHaveTextContent(
    /has not been sent again/u,
  );
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('asks before promoting, says what happens to the active key, and says it is ready', async () => {
  const user = userEvent.setup();
  const promoted = { ...READY_KEY, status: 'active' };
  const { sent } = renderConsoleAt(
    AT,
    keyRoutes(undefined, { [`POST ${KEYS}/k-ready/promote`]: json(promoted) }),
  );
  await user.click(await screen.findByRole('button', { name: 'Promote kid-k-ready' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Promote this key?' });
  expect(dialog).toHaveTextContent('signs every new token');
  expect(dialog).toHaveTextContent('kid-k-active');
  expect(dialog).not.toHaveTextContent('Ready from');
  expect(within(dialog).getByRole('button', { name: 'Promote key' })).toHaveAttribute(
    'data-variant',
    'primary',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Promote key' }));
  expect(await screen.findByText(/kid-k-ready is now the active key/u)).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST' && s.path.endsWith('/promote'))).toHaveLength(1);
  await waitFor(() => {
    expect(screen.getByRole('status', { name: 'Last key action' })).toHaveFocus();
  });
});

it('says why a young key is not ready in the promote dialog, and still lets it through', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    keyRoutes(
      undefined,
      { [`POST ${KEYS}/k-young/promote`]: json({ ...YOUNG_KEY, status: 'active' }) },
      [YOUNG_KEY, ACTIVE_KEY],
    ),
  );
  await user.click(await screen.findByRole('button', { name: 'Promote kid-k-young' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Promote this key?' });
  expect(dialog).toHaveTextContent(/Ready from \d{4}-\d{2}-\d{2}/u);
  expect(dialog).toHaveTextContent('the server does not refuse it');
  await user.click(within(dialog).getByRole('button', { name: 'Promote key' }));
  expect(await screen.findByText(/kid-k-young is now the active key/u)).toBeVisible();
});

it('presses once while a write is in flight and shows no failure for a second press', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    keyRoutes(undefined, { [`POST ${KEYS}/k-ready/promote`]: pending() }),
  );
  await user.click(await screen.findByRole('button', { name: 'Promote kid-k-ready' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Promote key' }));
  const working = await within(dialog).findByRole('button', { name: 'Working…' });
  expect(working).toBeDisabled();
  await user.click(working);
  await user.keyboard('{Enter}');
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(sent.filter((s) => s.path.endsWith('/promote'))).toHaveLength(1);
});

it('says an other-algorithm key changes the algorithm instead of calling it not ready', async () => {
  const rs = signingKey('k-rs', 'rotating', {
    alg: 'RS256',
    created_at: '2026-10-05T00:00:00.000Z',
  });
  renderConsoleAt(AT, keyRoutes(undefined, {}, [rs, ACTIVE_KEY]));
  const row = await within(await lane('Rotating keys')).findByRole('row', { name: /kid-k-rs/u });
  expect(row).toHaveTextContent('Changes algorithm');
  expect(row).not.toHaveTextContent('Not ready');
});

it('keeps the promote dialog and says so when the key can no longer be promoted', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`POST ${KEYS}/k-ready/promote`]: problem(404, 'about:blank', 'Not Found'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Promote kid-k-ready' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Promote key' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('can no longer be promoted');
});

it('reads whoami again after a refusal, and asks afresh once cancelled', async () => {
  await expectRefusedThenCancelled(
    AT,
    keyRoutes(undefined, {
      [`POST ${KEYS}/k-ready/promote`]: problem(403, 'about:blank', 'Forbidden'),
    }),
    { open: 'Promote kid-k-ready', confirm: 'Promote key' },
  );
});

it('retires only once the kid is typed, and says what is lost', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`POST ${KEYS}/k-ready/retire`]: json({ ...READY_KEY, status: 'retired' }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Retire kid-k-ready' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Retire this key?' });
  expect(dialog).toHaveTextContent('stops verifying');
  const confirm = within(dialog).getByRole('button', { name: 'Retire key' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox'), 'kid-k-ready');
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  expect(await screen.findByText(/kid-k-ready was retired/u)).toBeVisible();
  expect(sent.filter((s) => s.path === `${KEYS}/k-ready/retire`)).toHaveLength(1);
});

it('shows the active-key refusal beside the action, worded from its type', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`POST ${KEYS}/k-ready/retire`]: problem(409, 'about:blank#key-active', 'Conflict', {
        detail: 'signing key k-ready is active; promote another key first',
      }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Retire kid-k-ready' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'kid-k-ready');
  await user.click(within(dialog).getByRole('button', { name: 'Retire key' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'The active key cannot be retired. Promote another key first',
  );
});

it('shows which clients still need the algorithm when a retire is refused for it', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`POST ${KEYS}/k-ready/retire`]: problem(
        409,
        'about:blank#key-algorithm-needed',
        'Conflict',
        {
          detail: 'prose',
          errors: [{ path: 'clients', message: 'billing' }],
        },
      ),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Retire kid-k-ready' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'kid-k-ready');
  await user.click(within(dialog).getByRole('button', { name: 'Retire key' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/billing/u);
});

it('treats a retire of a key the server no longer has as already gone', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`POST ${KEYS}/k-ready/retire`]: problem(404, 'about:blank', 'Not Found'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Retire kid-k-ready' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'kid-k-ready');
  await user.click(within(dialog).getByRole('button', { name: 'Retire key' }));
  expect(await screen.findByText(/already gone/u)).toBeVisible();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('deletes a retired key after a confirmation that says it is for good', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`DELETE ${KEYS}/k-retired`]: () => new Response(null, { status: 204 }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete kid-k-retired' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete this key?' });
  expect(dialog).toHaveTextContent('cannot be undone');
  await user.click(within(dialog).getByRole('button', { name: 'Delete key' }));
  expect(await screen.findByText(/kid-k-retired was deleted/u)).toBeVisible();
  expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
});

it('pages a lane with Load more', async () => {
  const user = userEvent.setup();
  const second = signingKey('k-old', 'retired');
  const { sent } = renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`GET ${KEYS}`]: (request) =>
        request.search.get('status') !== 'retired'
          ? lanes([READY_KEY, ACTIVE_KEY])(request)
          : json(
              request.search.get('cursor') === null
                ? { items: [RETIRED_KEY], next: 'c2' }
                : { items: [second] },
            )(request),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Load more retired keys' }));
  await waitFor(() => {
    expect(sent.some((s) => s.search.get('cursor') === 'c2')).toBe(true);
  });
  expect(await screen.findByRole('row', { name: /kid-k-old/u })).toBeVisible();
});

it('says it is loading more, and holds the button, while the next page is on its way', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`GET ${KEYS}`]: (request) => {
        if (request.search.get('status') !== 'retired')
          return lanes([READY_KEY, ACTIVE_KEY])(request);
        return request.search.get('cursor') === null
          ? json({ items: [RETIRED_KEY], next: 'c2' })(request)
          : pending()(request);
      },
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Load more retired keys' }));
  expect(await screen.findByRole('button', { name: 'Loading more retired keys…' })).toBeDisabled();
});

it('says a later page of a lane could not be loaded, keeping the keys shown', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`GET ${KEYS}`]: (request) => {
        if (request.search.get('status') !== 'retired')
          return lanes([READY_KEY, ACTIVE_KEY])(request);
        return request.search.get('cursor') === null
          ? json({ items: [RETIRED_KEY], next: 'c2' })(request)
          : problem(500, 'about:blank', 'Error')(request);
      },
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Load more retired keys' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'More retired keys could not be loaded. Load more tries again.',
  );
  expect(screen.getByRole('row', { name: /kid-k-retired/u })).toBeVisible();
});

it('says a lane could not be loaded and tries again', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    keyRoutes(undefined, {
      [`GET ${KEYS}`]: (request) =>
        request.search.get('status') === 'retired'
          ? problem(500, 'about:blank', 'Error')(request)
          : lanes([READY_KEY, ACTIVE_KEY])(request),
    }),
  );
  expect(await screen.findByText('Retired keys could not be loaded')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
});

it('names manage-keys for a caller without it and reads no key', async () => {
  const { sent } = renderConsoleAt(AT, keyRoutes(['manage-tenant']));
  expect(await screen.findByRole('note')).toHaveTextContent('manage-keys');
  expect(screen.queryByRole('button', { name: 'Stage key' })).toBeNull();
  expect(sent.some((s) => s.path === KEYS)).toBe(false);
});

it('passes axe in both themes, listed and refused', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, keyRoutes()).element,
      () => lane('Retired keys'),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, keyRoutes(['manage-tenant'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('passes axe in both themes with the retire dialog open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, keyRoutes()).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Retire kid-k-ready' }));
        return screen.findByRole('alertdialog');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
