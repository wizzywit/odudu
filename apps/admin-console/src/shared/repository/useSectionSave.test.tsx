import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import { storeDrafts } from '#/shared/adapter/draftStorage.ts';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useRecord } from '#/shared/repository/useRecord.ts';
import { useSectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { describeValue } from '#/shared/service/conflict.ts';
import type { Gateway } from '#/shared/transport/gateway.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { NumberWithUnitField, TextField } from '#/shared/view/Field.tsx';
import { Section } from '#/shared/view/Section.tsx';
import {
  fakeTransport,
  inTurn,
  json,
  pending,
  problem,
  type Answer,
} from '#/testing/fakeTransport.ts';

const PATH = '/console/api/admin/tenants/acme/clients/c1';
const GET = `GET ${PATH}`;
const PATCH = `PATCH ${PATH}`;

const clientSchema = z.object({ name: z.string(), access_token_ttl: z.number() });
type Client = z.infer<typeof clientSchema>;

const LOADED: Client = { name: 'Billing portal', access_token_ttl: 300 };

function client(body: Client, etag: string): Answer {
  return json(body, 200, { etag });
}

const read = (gateway: Gateway) =>
  gateway.request('GET', 'admin/tenants/acme/clients/c1', { schema: clientSchema });

function amend(gateway: Gateway, body: unknown, ifMatch: string) {
  return gateway.request('PATCH', 'admin/tenants/acme/clients/c1', {
    body,
    ifMatch,
    schema: clientSchema,
  });
}

function Conflicts({
  save,
}: {
  save: ReturnType<typeof useSectionSave<{ name: string }, Client>>;
}) {
  if (save.conflicts.length === 0) return null;
  return (
    <div>
      <ul aria-label="Conflicts">
        {save.conflicts.map((conflict) => (
          <li key={conflict.field}>
            {`${conflict.label}: theirs ${describeValue(conflict.theirs)}, yours ${describeValue(conflict.yours)}`}
          </li>
        ))}
      </ul>
      <button type="button" onClick={save.keepMine}>
        Keep mine
      </button>
      <button type="button" onClick={save.takeTheirs}>
        Take theirs
      </button>
    </div>
  );
}

function General({ data, etag }: { data: Client; etag: string | null }) {
  const save = useSectionSave({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'general',
    label: 'General',
    etag,
    fields: { name: { value: data.name, label: 'Name', kind: 'plain' } },
    save: (gateway, { changes, ifMatch }) => amend(gateway, changes, ifMatch),
  });
  return (
    <Section
      title="General"
      dirty={save.dirty}
      saving={save.saving}
      onSave={save.submit}
      onDiscard={save.discard}
      notice={
        <>
          <Conflicts save={save} />
          {save.message === null ? null : <p>{save.message}</p>}
          <p>{`status ${save.status}`}</p>
        </>
      }
    >
      <TextField
        label="Name"
        value={save.values.name}
        error={save.fieldErrors.name}
        onChange={(name) => {
          save.edit('name', name);
        }}
      />
    </Section>
  );
}

function Tokens({ data, etag }: { data: Client; etag: string | null }) {
  const save = useSectionSave({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'tokens',
    label: 'Tokens',
    etag,
    fields: {
      access_token_ttl: {
        value: data.access_token_ttl,
        label: 'Access token lifetime',
        kind: 'plain',
      },
    },
    save: (gateway, { changes, ifMatch }) => amend(gateway, changes, ifMatch),
  });
  return (
    <Section
      title="Tokens"
      dirty={save.dirty}
      saving={save.saving}
      onSave={save.submit}
      onDiscard={save.discard}
      notice={
        <ul aria-label="Token conflicts">
          {save.conflicts.map((conflict) => (
            <li key={conflict.field}>{conflict.label}</li>
          ))}
        </ul>
      }
    >
      <NumberWithUnitField
        label="Access token lifetime"
        unit="seconds"
        value={save.values.access_token_ttl}
        onChange={(ttl) => {
          save.edit('access_token_ttl', ttl);
        }}
      />
    </Section>
  );
}

function ClientRecord() {
  const record = useRecord({ tenant: 'acme', record: 'clients/c1', read });
  if (record.data === undefined) return <p>Loading</p>;
  return (
    <>
      <General data={record.data} etag={record.etag} />
      <Tokens data={record.data} etag={record.etag} />
    </>
  );
}

function mount(routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const queryClient = createQueryClient();
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={queryClient}>
        <ClientRecord />
      </QueryClientProvider>
    </TransportContext>,
  );
  const patches = () => fake.sent.filter((request) => request.method === 'PATCH');
  const reads = () => fake.sent.filter((request) => request.method === 'GET').length;
  return { ...fake, patches, reads, queryClient };
}

afterEach(() => {
  useToasts.setState({ toasts: [] });
  useUnsavedGuard.getState().reset();
  useDrafts.getState().forgetAll();
});

const general = () => screen.getByRole('region', { name: 'General' });
const tokens = () => screen.getByRole('region', { name: 'Tokens' });

async function rename(user: ReturnType<typeof userEvent.setup>, name: string) {
  const region = await screen.findByRole('region', { name: 'General' });
  const field = within(region).getByRole('textbox', { name: 'Name' });
  await user.clear(field);
  await user.type(field, name);
}

it('sends only its own changes, with the ETag its record loaded with', async () => {
  const user = userEvent.setup();
  const saved: Client = { ...LOADED, name: 'Billing' };
  const { patches } = mount({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: client(saved, '"e2"'),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));

  await waitFor(() => {
    expect(within(general()).queryByRole('button', { name: 'Save General' })).toBeNull();
  });
  expect(patches()).toEqual([
    expect.objectContaining({ ifMatch: '"e1"', body: { name: 'Billing' } }),
  ]);
  expect(within(general()).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing');
  expect(within(general()).getByText('status saved')).toBeVisible();
  expect(useToasts.getState().toasts).toEqual([
    expect.objectContaining({ tone: 'success', message: 'General saved' }),
  ]);
});

it('keeps one request in flight per section', async () => {
  const user = userEvent.setup();
  const { patches } = mount({ [GET]: client(LOADED, '"e1"'), [PATCH]: pending() });
  await rename(user, 'Billing');
  const name = within(general()).getByRole('textbox', { name: 'Name' });
  await user.type(name, '{Enter}');
  await user.type(name, '{Enter}');
  expect(within(general()).getByRole('button', { name: 'Saving… General' })).toBeDisabled();
  expect(patches()).toHaveLength(1);
});

it('places each structured field error under its field and the rest in a toast', async () => {
  const user = userEvent.setup();
  mount({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: problem(400, 'about:blank', 'Bad Request', {
      detail: 'name: is taken; tenant: is disabled',
      errors: [
        { path: 'name', message: 'is taken' },
        { path: 'tenant', message: 'is disabled' },
      ],
    }),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));

  const name = await within(general()).findByRole('textbox', { name: 'Name' });
  await waitFor(() => {
    expect(name).toHaveAccessibleDescription('is taken');
  });
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(useToasts.getState().toasts).toEqual([
    expect.objectContaining({
      tone: 'error',
      message: 'General was not saved: tenant: is disabled',
    }),
  ]);
});

it('reads the field from the detail when the refusal carries no errors', async () => {
  const user = userEvent.setup();
  mount({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: problem(400, 'about:blank', 'Bad Request', { detail: 'name: must not be empty' }),
  });
  await rename(user, 'x');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  const name = within(general()).getByRole('textbox', { name: 'Name' });
  await waitFor(() => {
    expect(name).toHaveAccessibleDescription('must not be empty');
  });
  await user.type(name, 'y');
  expect(name).not.toHaveAttribute('aria-invalid', 'true');
});

it('on a 412 re-reads the record and shows theirs beside yours, merging nothing', async () => {
  const user = userEvent.setup();
  const theirs: Client = { ...LOADED, name: 'Payments' };
  const { reads, patches } = mount({
    [GET]: inTurn(client(LOADED, '"e1"'), client(theirs, '"e2"')),
    [PATCH]: inTurn(
      problem(412, 'about:blank', 'Precondition Failed', { detail: 'If-Match no longer matches' }),
      client({ ...theirs, name: 'Billing' }, '"e3"'),
    ),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));

  const conflicts = await screen.findByRole('list', { name: 'Conflicts' });
  expect(reads()).toBe(2);
  expect(within(conflicts).getByRole('listitem')).toHaveTextContent(
    'Name: theirs Payments, yours Billing',
  );
  expect(within(general()).getByText('status conflict')).toBeVisible();
  expect(within(general()).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing');

  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  expect(patches()).toHaveLength(1);

  await user.click(screen.getByRole('button', { name: 'Keep mine' }));
  await waitFor(() => {
    expect(patches()).toHaveLength(2);
  });
  expect(patches()[1]).toEqual(
    expect.objectContaining({ ifMatch: '"e2"', body: { name: 'Billing' } }),
  );
  await waitFor(() => {
    expect(screen.queryByRole('list', { name: 'Conflicts' })).toBeNull();
  });
});

it('takes theirs by dropping only the conflicting edits', async () => {
  const user = userEvent.setup();
  const theirs: Client = { ...LOADED, name: 'Payments' };
  const { patches } = mount({
    [GET]: inTurn(client(LOADED, '"e1"'), client(theirs, '"e2"')),
    [PATCH]: problem(412, 'about:blank', 'Precondition Failed'),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await user.click(await screen.findByRole('button', { name: 'Take theirs' }));

  expect(within(general()).getByRole('textbox', { name: 'Name' })).toHaveValue('Payments');
  expect(within(general()).queryByRole('button', { name: 'Save General' })).toBeNull();
  expect(patches()).toHaveLength(1);
});

it('keeps edits on the fresh read after a 412 whose change touched none of them', async () => {
  const user = userEvent.setup();
  const theirs: Client = { ...LOADED, access_token_ttl: 600 };
  const { patches } = mount({
    [GET]: inTurn(client(LOADED, '"e1"'), client(theirs, '"e2"')),
    [PATCH]: inTurn(problem(412, 'about:blank', 'Precondition Failed'), client(theirs, '"e3"')),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));

  expect(await within(general()).findByText('status stale')).toBeVisible();
  expect(screen.queryByRole('list', { name: 'Conflicts' })).toBeNull();
  expect(within(general()).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(patches()).toHaveLength(2);
  });
  expect(patches()[1]).toEqual(
    expect.objectContaining({ ifMatch: '"e2"', body: { name: 'Billing' } }),
  );
});

it("rebases the record's other dirty sections on what a save returns", async () => {
  const user = userEvent.setup();
  const { patches } = mount({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: inTurn(
      client({ name: 'Billing', access_token_ttl: 900 }, '"e2"'),
      client({ name: 'Billing', access_token_ttl: 1200 }, '"e3"'),
    ),
  });
  const region = await screen.findByRole('region', { name: 'Tokens' });
  const ttl = within(region).getByRole('textbox', { name: 'Access token lifetime' });
  await user.clear(ttl);
  await user.type(ttl, '1200');
  await user.tab();
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));

  const conflicts = await screen.findByRole('list', { name: 'Token conflicts' });
  await waitFor(() => {
    expect(within(conflicts).getByRole('listitem')).toHaveTextContent('Access token lifetime');
  });
  expect(within(tokens()).getByRole('textbox', { name: 'Access token lifetime' })).toHaveValue(
    '1200',
  );
  expect(patches()).toHaveLength(1);
});

it('says a guard refusal beside the action, not in a toast', async () => {
  const user = userEvent.setup();
  mount({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: problem(409, 'about:blank#last-administrator', 'Conflict', {
      detail: 'grace is the last enabled administrator',
    }),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  expect(
    await within(general()).findByText('grace is the last enabled administrator'),
  ).toBeVisible();
  expect(within(general()).getByText('status refused')).toBeVisible();
  expect(useToasts.getState().toasts).toEqual([]);
});

it('says a save whose answer never came could not be confirmed, and keeps the edits', async () => {
  const user = userEvent.setup();
  mount({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        tone: 'error',
        message:
          'Could not confirm that General was saved. Your changes are still here, and saving again is safe.',
      }),
    ]);
  });
  expect(within(general()).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing');
});

it('puts back a kept draft, showing theirs beside it when the record moved on since', async () => {
  storeDrafts({
    owner: 'acme/s1',
    drafts: { 'acme/clients/c1': { general: { etag: '"e0"', values: { name: 'Billing' } } } },
  });
  const { patches } = mount({ [GET]: client(LOADED, '"e1"'), [PATCH]: pending() });
  const conflicts = await screen.findByRole('list', { name: 'Conflicts' });
  expect(within(conflicts).getByRole('listitem')).toHaveTextContent(
    'Name: theirs Billing portal, yours Billing',
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(patches()).toEqual([]);
});

it('puts back a kept draft made against the record as it stands, with no conflict', async () => {
  const user = userEvent.setup();
  storeDrafts({
    owner: 'acme/s1',
    drafts: { 'acme/clients/c1': { general: { etag: '"e1"', values: { name: 'Billing' } } } },
  });
  const { patches } = mount({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: client({ ...LOADED, name: 'Billing' }, '"e2"'),
  });
  const name = await within(await screen.findByRole('region', { name: 'General' })).findByRole(
    'textbox',
    { name: 'Name' },
  );
  expect(name).toHaveValue('Billing');
  expect(screen.queryByRole('list', { name: 'Conflicts' })).toBeNull();
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(patches()).toEqual([expect.objectContaining({ ifMatch: '"e1"' })]);
  });
});
