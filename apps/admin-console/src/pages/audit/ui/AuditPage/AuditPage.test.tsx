import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AUDIT, auditRoutes, CLIENT_ID, GRACE_ID, TRAIL } from '#/testing/auditFixtures';
import { at } from '#/testing/at';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, offline, pending, problem, type Answer } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

const saved: string[] = [];

beforeEach(() => {
  saved.length = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConsole();
});

const AT = '/console/acme/audit';

function auditSent(sent: readonly { path: string; search: URLSearchParams }[]) {
  return sent.filter((request) => request.path === AUDIT);
}

async function table() {
  return screen.findByRole('grid', { name: 'Audit events' });
}

async function rowsOf() {
  return within(await table())
    .getAllByRole('row')
    .slice(1);
}

it('lists the trail newest first and says it has no count', async () => {
  renderConsoleAt(AT, auditRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Audit trail' })).toBeVisible();
  const rows = await rowsOf();
  expect(rows.map((row) => row.querySelector('code')?.textContent)).toEqual([
    'client.update',
    'client.rotate_secret',
    'tenant.amend_settings',
  ]);
  expect(screen.getByText(/The audit trail has no count/u)).toBeVisible();
  expect(screen.getByText(/3 events loaded, from/u)).toBeVisible();
});

it('asks the API for no filter at first, and one page', async () => {
  const { sent } = renderConsoleAt(AT, auditRoutes());
  await table();
  expect(auditSent(sent).map((request) => request.search.toString())).toEqual(['']);
});

it('labels the rows of one request, and says it groups only what is loaded', async () => {
  renderConsoleAt(AT, auditRoutes());
  const rows = await rowsOf();
  expect(rows[0]).toHaveTextContent('request aaaaaa · 2 rows loaded');
  expect(rows[1]).toHaveTextContent('request aaaaaa · 2 rows loaded');
  expect(rows[2]).not.toHaveTextContent('rows loaded');
  expect(screen.getByText(/groups only the rows loaded here/u)).toBeVisible();
});

it('marks a caller from elsewhere and shows its id with the reason', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, auditRoutes());
  const rows = await rowsOf();
  expect(rows[2]).toHaveTextContent('from elsewhere');
  expect(rows[0]).not.toHaveTextContent('from elsewhere');
  await user.click(within(at(rows, 2)).getByRole('button', { name: /^Details of/u }));
  const dialog = await screen.findByRole('dialog', { name: 'Audit event' });
  expect(dialog).toHaveTextContent(/system administrator acting across tenants/u);
  expect(dialog).toHaveTextContent('0192f7a4-9999-7b3a-9d2e-6f8a1b2c3d4e');
});

it('links the resource to its record, and an actor of this tenant to its subject', async () => {
  renderConsoleAt(AT, auditRoutes());
  const first = at(await rowsOf(), 0);
  expect(
    within(first).getByRole('link', { name: new RegExp(`client ${CLIENT_ID}`, 'u') }),
  ).toHaveAttribute('href', `/console/acme/clients/${CLIENT_ID}`);
  expect(within(first).getByRole('link', { name: 'grace, open the subject' })).toHaveAttribute(
    'href',
    `/console/acme/subjects/${GRACE_ID}`,
  );
});

it('offers no link to a subject without view-users', async () => {
  renderConsoleAt(AT, auditRoutes(['view-audit']));
  const first = at(await rowsOf(), 0);
  expect(within(first).queryByRole('link', { name: /open the subject/u })).toBeNull();
});

it('opens a row to all of its fields and its detail as keys and values', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, auditRoutes());
  const first = at(await rowsOf(), 0);
  await user.click(within(first).getByRole('button', { name: 'Details of client.update' }));
  const dialog = await screen.findByRole('dialog', { name: 'Audit event' });
  expect(within(dialog).getByText('true → false')).toBeVisible();
  expect(within(dialog).getByText('When', { selector: 'dt' })).toBeVisible();
  expect(within(dialog).getByRole('link', { name: 'Open the client' })).toBeVisible();
});

it('reads the filters from the address into the form and the request', async () => {
  const { sent } = renderConsoleAt(
    `${AT}?outcome=refused&resource_type=client&resource_id=${CLIENT_ID}&action=client.update`,
    auditRoutes(),
  );
  await table();
  const query = auditSent(sent)[0]?.search;
  expect(query?.get('outcome')).toBe('refused');
  expect(query?.get('resource_type')).toBe('client');
  expect(query?.get('resource_id')).toBe(CLIENT_ID);
  expect(query?.get('action')).toBe('client.update');
  expect(screen.getByRole('textbox', { name: 'Action' })).toHaveValue('client.update');
  expect(screen.getByRole('textbox', { name: 'Resource id' })).toHaveValue(CLIENT_ID);
  expect(screen.getByRole('button', { name: /Outcome/u })).toHaveTextContent('Refused');
});

it('applies the filters to the address, and reads again from the first page', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(AT, auditRoutes());
  await table();
  await user.type(screen.getByRole('textbox', { name: 'Action' }), 'client.update');
  await user.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => {
    expect(router.state.location.search).toEqual({ action: 'client.update' });
  });
  await waitFor(() => {
    expect(auditSent(sent).at(-1)?.search.get('action')).toBe('client.update');
  });
});

it('cannot hold a resource id until there is a resource type', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, auditRoutes());
  await table();
  const id = screen.getByRole('textbox', { name: 'Resource id' });
  expect(id).toBeDisabled();
  expect(screen.getByText('Choose a resource type first.')).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: 'Resource type' }), 'client');
  expect(id).toBeEnabled();
  await user.type(id, 'c1');
  await user.clear(screen.getByRole('textbox', { name: 'Resource type' }));
  expect(id).toBeDisabled();
  expect(id).toHaveValue('');
});

it('refuses an actor that is not a UUID, beside the field, and sends nothing', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, auditRoutes());
  await table();
  await user.type(screen.getByRole('textbox', { name: 'Actor (subject id)' }), 'grace');
  await user.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(await screen.findByText(/A subject id is a UUID/u)).toBeVisible();
  expect(auditSent(sent)).toHaveLength(1);
});

function fill(name: string, local: string) {
  fireEvent.input(screen.getByLabelText(name), { target: { value: local } });
}

// What a browser reports for a date it was given and could not complete.
function fillUnreadable(name: string) {
  const field = screen.getByLabelText(name);
  Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
  fireEvent.input(field, { target: { value: '' } });
}

it('explains a range that ends before it starts, and sends nothing', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, auditRoutes());
  await table();
  fill('From', '2026-10-12T12:00');
  fill('To', '2026-10-11T12:00');
  await user.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(await screen.findByText(/To is before From/u)).toBeVisible();
  expect(auditSent(sent)).toHaveLength(1);
});

it('sends a range in UTC, inclusive at both ends', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(AT, auditRoutes());
  await table();
  fill('From', '2026-10-11T12:00');
  fill('To', '2026-10-12T12:00');
  await user.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => {
    expect(router.state.location.search).toMatchObject({
      from: expect.stringMatching(/^2026-10-11T\d\d:00:00\.000Z$/u) as unknown,
      to: expect.stringMatching(/^2026-10-12T\d\d:00:59\.999Z$/u) as unknown,
    });
  });
});

it('ignores a value in the address the API would refuse, and says so', async () => {
  const { sent } = renderConsoleAt(
    `${AT}?outcome=maybe&actor_subject_id=grace&action=ok`,
    auditRoutes(),
  );
  await table();
  expect(auditSent(sent)[0]?.search.toString()).toBe('action=ok');
  expect(screen.getByText(/outcome the trail cannot read/u)).toBeVisible();
  expect(screen.getByText(/actor the trail cannot read/u)).toBeVisible();
});

it('says no event matches when filters leave nothing, with a way back', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(
    `${AT}?action=nothing.here`,
    auditRoutes(undefined, { [`GET ${AUDIT}`]: json({ items: [] }) }),
  );
  expect(
    await screen.findByRole('heading', { name: 'No event matches these filters' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Show every event' }));
  await waitFor(() => {
    expect(router.state.location.search).toEqual({});
  });
});

it('says nothing has been recorded when the trail is empty', async () => {
  renderConsoleAt(AT, auditRoutes(undefined, { [`GET ${AUDIT}`]: json({ items: [] }) }));
  expect(await screen.findByRole('heading', { name: 'No audit events yet' })).toBeVisible();
});

it('pages on with a cursor trail kept in the address', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    auditRoutes(undefined, {
      [`GET ${AUDIT}`]: (request) =>
        json(
          request.search.get('cursor') === null
            ? { items: TRAIL.slice(0, 2), next: 'Zmlyc3Q.dGFn' }
            : { items: TRAIL.slice(2) },
        )(request),
    }),
  );
  await table();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => {
    expect(auditSent(sent).some((request) => request.search.get('cursor') === 'Zmlyc3Q.dGFn')).toBe(
      true,
    );
  });
  expect(router.state.location.search).toEqual({ after: 'Zmlyc3Q.dGFn' });
  expect(await screen.findByText('tenant.amend_settings')).toBeVisible();
});

it('appends the next page in place on Load more, from the cursor the last one named', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    auditRoutes(undefined, {
      [`GET ${AUDIT}`]: (request) =>
        json(
          request.search.get('cursor') === null
            ? { items: TRAIL.slice(0, 2), next: 'Zmlyc3Q.dGFn' }
            : { items: TRAIL.slice(2) },
        )(request),
    }),
  );
  expect(await rowsOf()).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Load more audit events' }));
  await waitFor(async () => {
    expect(await rowsOf()).toHaveLength(3);
  });
  expect(auditSent(sent).map((request) => request.search.get('cursor'))).toEqual([
    null,
    'Zmlyc3Q.dGFn',
  ]);
});

it('appends the next page on Load more after paging forward and back', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    auditRoutes(undefined, {
      [`GET ${AUDIT}`]: (request) => {
        const cursor = request.search.get('cursor');
        if (cursor === null)
          return json({ items: TRAIL.slice(0, 1), next: 'Zmlyc3Q.dGFn' })(request);
        if (cursor === 'Zmlyc3Q.dGFn')
          return json({ items: TRAIL.slice(1, 2), next: 'c2Vjb25k.dGFn' })(request);
        return json({ items: TRAIL.slice(2) })(request);
      },
    }),
  );
  expect(await rowsOf()).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByText('client.rotate_secret')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(await screen.findByText('client.update')).toBeVisible();
  const before = auditSent(sent).length;
  await waitFor(async () => {
    await user.click(screen.getByRole('button', { name: 'Load more audit events' }));
    expect(auditSent(sent).length).toBeGreaterThan(before);
  });
  await waitFor(async () => {
    expect(await rowsOf()).toHaveLength(2);
  });
});

it('resets the cursor trail when a filter changes', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(`${AT}?after=Zmlyc3Q.dGFn`, auditRoutes());
  await table();
  await user.type(screen.getByRole('textbox', { name: 'Action' }), 'x');
  await user.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => {
    expect(router.state.location.search).toEqual({ action: 'x' });
  });
});

it('offers to start again when the cursor is no longer valid', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(
    `${AT}?after=Zmlyc3Q.dGFn`,
    auditRoutes(undefined, {
      [`GET ${AUDIT}`]: (request) =>
        request.search.get('cursor') === null
          ? json({ items: TRAIL })(request)
          : problem(400, 'about:blank', 'Bad Request', {
              detail: 'cursor is invalid or expired',
              errors: [{ path: 'cursor', message: 'is invalid or expired' }],
            })(request),
    }),
  );
  expect(
    await screen.findByRole('heading', { name: 'This page of the trail has expired' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Start again' }));
  await waitFor(() => {
    expect(router.state.location.search).toEqual({});
  });
  expect(await table()).toBeVisible();
});

it('shows a skeleton while it loads', async () => {
  renderConsoleAt(AT, auditRoutes(undefined, { [`GET ${AUDIT}`]: pending() }));
  expect(await screen.findByText('Loading audit events')).toBeInTheDocument();
});

it('says the trail could not be loaded, with a way to try again', async () => {
  renderConsoleAt(AT, auditRoutes(undefined, { [`GET ${AUDIT}`]: offline() }));
  expect(
    await screen.findByRole('heading', { name: 'The audit trail could not be loaded' }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
});

it('names view-audit when the server refuses the read', async () => {
  renderConsoleAt(AT, auditRoutes(undefined, { [`GET ${AUDIT}`]: problem(403) }));
  expect(await screen.findByText(/view-audit/u)).toBeVisible();
  expect(screen.queryByRole('grid')).toBeNull();
});

it('shows a limited operator what is missing, and reads nothing', async () => {
  const { sent } = renderConsoleAt(AT, auditRoutes(['view-users']));
  expect(await screen.findByText(/view-audit/u)).toBeVisible();
  expect(auditSent(sent)).toHaveLength(0);
  expect(screen.queryByRole('search')).toBeNull();
});

it('passes axe in both themes: rows, empty, failed and refused', async () => {
  const states = [
    auditRoutes(),
    auditRoutes(undefined, { [`GET ${AUDIT}`]: json({ items: [] }) }),
    auditRoutes(undefined, { [`GET ${AUDIT}`]: offline() }),
    auditRoutes(undefined, { [`GET ${AUDIT}`]: problem(403) }),
    auditRoutes(['view-users']),
    auditRoutes(undefined, { [`GET ${AUDIT}`]: TOO_BROAD }),
  ];
  for (const routes of states) {
    expect(
      await axeInBothThemes(
        () => consoleAt(AT, routes).element,
        () => screen.findByRole('heading', { level: 1, name: 'Audit trail' }),
      ),
    ).toEqual({ light: [], dark: [] });
  }
});

const NDJSON: Answer = () =>
  new Response('{"id":"e3"}\n{"id":"e2"}\n', {
    headers: { 'content-type': 'application/x-ndjson' },
  });

it('exports the events the applied filters match, as a file named for the day', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    `${AT}?outcome=refused`,
    auditRoutes(undefined, { [`GET ${AUDIT}/export`]: NDJSON }),
  );
  await table();
  await user.type(screen.getByRole('textbox', { name: 'Action' }), 'typed but not applied');
  await user.click(screen.getByRole('button', { name: 'Export these events' }));
  const today = new Date().toISOString().slice(0, 10);
  expect(await screen.findByText(`Saved acme-audit-${today}.ndjson, 2 events.`)).toBeVisible();
  expect(saved).toEqual([`acme-audit-${today}.ndjson`]);
  const request = sent.find((each) => each.path === `${AUDIT}/export`);
  expect(request?.search.toString()).toBe('outcome=refused');
});

it('says the filters match more than an export holds, and saves nothing', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    auditRoutes(undefined, {
      [`GET ${AUDIT}/export`]: problem(413, 'about:blank#export-too-large', 'Content Too Large'),
    }),
  );
  await table();
  await user.click(screen.getByRole('button', { name: 'Export these events' }));
  expect(await screen.findByText(/Narrow the filters and export again/u)).toBeVisible();
  expect(saved).toEqual([]);
});

it('names view-audit when the export is refused', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, auditRoutes(undefined, { [`GET ${AUDIT}/export`]: problem(403) }));
  await table();
  await user.click(screen.getByRole('button', { name: 'Export these events' }));
  expect(await screen.findByText('Exporting the trail needs view-audit.')).toBeVisible();
});

it('offers no export where the trail is refused', async () => {
  renderConsoleAt(AT, auditRoutes(undefined, { [`GET ${AUDIT}`]: problem(403) }));
  expect(await screen.findByText(/view-audit/u)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Export these events' })).toBeNull();
});

const TOO_BROAD: Answer = problem(400, 'about:blank#audit-query-too-broad', 'Bad Request', {
  detail: 'these filters could not be searched within 5 seconds',
});

it('says the filters are too broad, which were on, and offers a time range', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(
    `${AT}?action=client.update&outcome=allowed`,
    auditRoutes(undefined, { [`GET ${AUDIT}`]: TOO_BROAD }),
  );
  expect(
    await screen.findByRole('heading', { name: 'These filters are too broad to search' }),
  ).toBeVisible();
  expect(screen.getByText(/with action and outcome/u)).toBeVisible();
  expect(screen.getByText(/Choose a time range/u)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'The audit trail could not be loaded' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Search the last 24 hours' }));
  await waitFor(() => {
    expect(router.state.location.search).toMatchObject({
      action: 'client.update',
      outcome: 'allowed',
      from: expect.stringMatching(/:00\.000Z$/u) as unknown,
      to: expect.stringMatching(/:59\.999Z$/u) as unknown,
    });
  });
});

it('asks for a narrower range when the filters already hold one', async () => {
  renderConsoleAt(
    `${AT}?action=client.update&from=2026-01-01T00:00:00.000Z`,
    auditRoutes(undefined, { [`GET ${AUDIT}`]: TOO_BROAD }),
  );
  expect(await screen.findByText(/Narrow the range, or drop one of them/u)).toBeVisible();
});

it('names the same refusal when an export or a reload is too broad, not a generic failure', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, auditRoutes(undefined, { [`GET ${AUDIT}/export`]: TOO_BROAD }));
  await table();
  await user.click(screen.getByRole('button', { name: 'Export these events' }));
  expect(
    await screen.findByText(/could not be exported in time. Choose a time range/u),
  ).toBeVisible();
});

it('never applies a date that reads as nothing: the field says so, Apply is held, nothing is sent', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(AT, auditRoutes());
  await table();
  fillUnreadable('From');
  const apply = screen.getByRole('button', { name: 'Apply filters' });
  expect(screen.getByLabelText('From')).toBeInvalid();
  expect(apply).toBeDisabled();
  expect(screen.getByText(/the trail is not narrowed by it until then/u)).toBeVisible();
  await user.click(screen.getByRole('textbox', { name: 'Action' }));
  expect(screen.getByLabelText('From')).toBeInvalid();
  await user.keyboard('x{Enter}');
  expect(auditSent(sent).filter((request) => request.search.has('action'))).toEqual([]);
  expect(router.state.location.search).toEqual({});
});
