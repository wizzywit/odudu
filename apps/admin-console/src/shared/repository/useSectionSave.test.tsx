import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import { storeDrafts } from '#/shared/adapter/draftStorage';
import { createReadCache } from '#/shared/repository/readCache';
import { recordKey } from '#/shared/repository/queryKeys';
import { useRecord } from '#/shared/repository/useRecord';
import { useSectionSave, type RefusalReporter } from '#/shared/repository/useSectionSave';
import { useToasts } from '#/shared/repository/useToasts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import type { Gateway, GatewayFailure } from '#/shared/transport/gateway';
import type { Problem } from '#/shared/transport/problem';
import { TransportContext } from '#/shared/transport/useTransport';
import { NumberWithUnitField, TextField } from '#/shared/ui/Field';
import { Section } from '#/shared/ui/Section';
import { SectionNotice } from '#/shared/ui/SectionNotice';
import {
  fakeTransport,
  inTurn,
  json,
  pending,
  problem,
  type Answer,
} from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const PATH = `${ACME_ADMIN}/clients/c1`;
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

const NO_REFUSAL: RefusalReporter = { report: () => false };

function General({
  data,
  etag,
  gone = false,
  onRefused,
  refusal,
  explain,
}: {
  data: Client;
  etag: string;
  gone?: boolean;
  onRefused?: (failure: GatewayFailure) => void;
  refusal?: RefusalReporter;
  explain?: (problem: Problem) => string | null;
}) {
  const save = useSectionSave({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'general',
    label: 'General',
    etag,
    capability: 'manage-clients',
    gone,
    ...(onRefused === undefined ? {} : { onRefused }),
    refusal: refusal ?? NO_REFUSAL,
    ...(explain === undefined ? {} : { explain }),
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
      blocked={save.blocked}
      notice={
        <>
          <SectionNotice
            section="General"
            status={save.status}
            conflicts={save.conflicts}
            conflictSource={save.conflictSource}
            message={save.message}
            busy={save.saving}
            onKeepMine={save.keepMine}
            onTakeTheirs={save.takeTheirs}
            onReread={save.reread}
          />
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

function Tokens({ data, etag }: { data: Client; etag: string }) {
  const save = useSectionSave({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'tokens',
    label: 'Tokens',
    etag,
    capability: 'manage-clients',
    refusal: NO_REFUSAL,
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

function ClientRecord({
  onRefused,
  refusal,
  explain,
}: {
  onRefused?: (failure: GatewayFailure) => void;
  refusal?: RefusalReporter;
  explain?: (problem: Problem) => string | null;
}) {
  const record = useRecord({ tenant: 'acme', record: 'clients/c1', read });
  if (record.data === undefined || record.etag === null) return <p>Loading</p>;
  return (
    <>
      <General
        data={record.data}
        etag={record.etag}
        gone={record.gone}
        {...(onRefused === undefined ? {} : { onRefused })}
        {...(refusal === undefined ? {} : { refusal })}
        {...(explain === undefined ? {} : { explain })}
      />
      <Tokens data={record.data} etag={record.etag} />
    </>
  );
}

function mount(
  routes: Record<string, Answer>,
  onRefused?: (failure: GatewayFailure) => void,
  explain?: (problem: Problem) => string | null,
  refusal?: RefusalReporter,
) {
  const fake = fakeTransport(routes);
  const queryClient = createReadCache();
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={queryClient}>
        <ClientRecord
          {...(onRefused === undefined ? {} : { onRefused })}
          {...(refusal === undefined ? {} : { refusal })}
          {...(explain === undefined ? {} : { explain })}
        />
      </QueryClientProvider>
    </TransportContext>,
  );
  const patches = () => fake.sent.filter((request) => request.method === 'PATCH');
  const reads = () => fake.sent.filter((request) => request.method === 'GET').length;
  return { ...fake, patches, reads, queryClient };
}

afterEach(() => {
  resetConsole();
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

  const conflicts = await screen.findByRole('table', {
    name: 'Changed in General since you opened it',
  });
  expect(reads()).toBe(2);
  expect(within(conflicts).getAllByRole('row')[1]).toHaveTextContent('NamePaymentsBilling');
  expect(within(general()).getByText('status conflict')).toBeVisible();
  expect(within(general()).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing');

  expect(within(general()).getByRole('button', { name: 'Save General' })).toBeDisabled();
  expect(patches()).toHaveLength(1);

  await user.click(screen.getByRole('button', { name: 'Keep mine in General' }));
  await waitFor(() => {
    expect(patches()).toHaveLength(2);
  });
  expect(patches()[1]).toEqual(
    expect.objectContaining({ ifMatch: '"e2"', body: { name: 'Billing' } }),
  );
  await waitFor(() => {
    expect(screen.queryByRole('table')).toBeNull();
  });
});

it('keep mine sends the save at once on the fresh ETag, with the panel already gone', async () => {
  const user = userEvent.setup();
  const theirs: Client = { ...LOADED, name: 'Payments' };
  const { patches } = mount({
    [GET]: inTurn(client(LOADED, '"e1"'), client(theirs, '"e2"')),
    [PATCH]: inTurn(
      problem(412, 'about:blank', 'Precondition Failed', { detail: 'If-Match no longer matches' }),
      pending(),
    ),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await screen.findByRole('table', { name: 'Changed in General since you opened it' });

  await user.click(screen.getByRole('button', { name: 'Keep mine in General' }));
  // The request is out before the answer, so a reader of the stored record
  // has to wait for it; the panel and the focus do not.
  expect(patches()).toHaveLength(2);
  expect(patches()[1]).toEqual(
    expect.objectContaining({ ifMatch: '"e2"', body: { name: 'Billing' } }),
  );
  expect(within(general()).getByText('status saving')).toBeVisible();
  expect(screen.queryByRole('table')).toBeNull();
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
  await user.click(await screen.findByRole('button', { name: 'Take theirs in General' }));

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
  expect(screen.queryByRole('table')).toBeNull();
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

it('words a refusal in place when the section says what it means', async () => {
  const user = userEvent.setup();
  mount(
    {
      [GET]: client(LOADED, '"e1"'),
      [PATCH]: problem(409, 'about:blank#last-administrator', 'Conflict', { detail: 'raw' }),
    },
    undefined,
    (refusal) =>
      refusal.type === 'about:blank#last-administrator' ? 'grace is the last one.' : null,
  );
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  expect(await within(general()).findByText('grace is the last one.')).toBeVisible();
  expect(within(general()).queryByText('raw')).toBeNull();
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
  const conflicts = await screen.findByRole('table');
  expect(within(conflicts).getAllByRole('row')[1]).toHaveTextContent('NameBilling portalBilling');
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
  expect(screen.queryByRole('table')).toBeNull();
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(patches()).toEqual([expect.objectContaining({ ifMatch: '"e1"' })]);
  });
});

function Fragile({ data, etag, fail }: { data: Client; etag: string; fail: () => boolean }) {
  const save = useSectionSave({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'general',
    label: 'General',
    etag,
    capability: 'manage-clients',
    refusal: NO_REFUSAL,
    fields: { name: { value: data.name, label: 'Name', kind: 'plain' } },
    // Breaks after a round trip, as an adapter defect found in its answer would.
    save: async (gateway, { changes, ifMatch }) => {
      const answer = await amend(gateway, changes, ifMatch);
      if (fail()) throw new Error('the adapter broke');
      return answer;
    },
  });
  return (
    <Section
      title="General"
      dirty={save.dirty}
      saving={save.saving}
      onSave={save.submit}
      onDiscard={save.discard}
    >
      <TextField
        label="Name"
        value={save.values.name}
        onChange={(name) => {
          save.edit('name', name);
        }}
      />
    </Section>
  );
}

it('stays able to save after a save that threw', async () => {
  const user = userEvent.setup();
  const fake = fakeTransport({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: client({ ...LOADED, name: 'Billing' }, '"e2"'),
  });
  let failures = 1;
  function Page() {
    const record = useRecord({ tenant: 'acme', record: 'clients/c1', read });
    if (record.data === undefined || record.etag === null) return null;
    return <Fragile data={record.data} etag={record.etag} fail={() => failures-- > 0} />;
  }
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={createReadCache()}>
        <Page />
      </QueryClientProvider>
    </TransportContext>,
  );
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(useToasts.getState().toasts).toEqual([expect.objectContaining({ tone: 'error' })]);
  });
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(fake.sent.filter((request) => request.method === 'PATCH')).toHaveLength(2);
  });
});

const announced = () => within(general()).getByRole('status');

it('announces a conflict in one line, with the comparison beside the announcement', async () => {
  const user = userEvent.setup();
  mount({
    [GET]: inTurn(client(LOADED, '"e1"'), client({ ...LOADED, name: 'Payments' }, '"e2"')),
    [PATCH]: problem(412, 'about:blank', 'Precondition Failed'),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(announced()).toHaveTextContent(
      'Name in General changed elsewhere since you opened it. Keep yours or take theirs.',
    );
  });
  expect(within(announced()).queryByRole('table')).toBeNull();
  expect(
    within(general()).getByRole('button', { name: 'Save General' }),
  ).toHaveAccessibleDescription('Keep yours or take theirs before saving.');
});

it('announces a 412 that touched none of the edits, and asks for another save', async () => {
  const user = userEvent.setup();
  mount({
    [GET]: inTurn(client(LOADED, '"e1"'), client({ ...LOADED, access_token_ttl: 600 }, '"e2"')),
    [PATCH]: problem(412, 'about:blank', 'Precondition Failed'),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(announced()).toHaveTextContent(
      'General changed elsewhere since you opened it. None of your edits was touched, and they are kept on the new version: save again to apply them.',
    );
  });
});

it('announces a guard refusal', async () => {
  const user = userEvent.setup();
  mount({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: problem(409, 'about:blank#last-administrator', 'Conflict', {
      detail: 'grace is the last enabled administrator',
    }),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(announced()).toHaveTextContent('grace is the last enabled administrator');
  });
});

it('names the capability a 403 needed, hands the refusal on, and toasts nothing', async () => {
  const user = userEvent.setup();
  const refusals: GatewayFailure[] = [];
  mount(
    { [GET]: client(LOADED, '"e1"'), [PATCH]: problem(403, 'about:blank', 'Forbidden') },
    (failure) => {
      refusals.push(failure);
    },
  );
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(announced()).toHaveTextContent(
      'General was not saved: it needs the manage-clients capability.',
    );
  });
  expect(refusals).toEqual([expect.objectContaining({ kind: 'problem' })]);
  expect(useToasts.getState().toasts).toEqual([]);
});

it('tells the refusal reporter what a 403 needed, then the caller', async () => {
  const user = userEvent.setup();
  const told: string[] = [];
  mount(
    { [GET]: client(LOADED, '"e1"'), [PATCH]: problem(403, 'about:blank', 'Forbidden') },
    () => {
      told.push('onRefused');
    },
    undefined,
    {
      report: (_failure, needed) => {
        told.push(`report ${needed}`);
        return true;
      },
    },
  );
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(told).toEqual(['report manage-clients', 'onRefused']);
  });
});

it('does not tell the refusal reporter of a failure that was no refusal', async () => {
  const user = userEvent.setup();
  const told: string[] = [];
  mount(
    { [GET]: client(LOADED, '"e1"'), [PATCH]: problem(500, 'about:blank', 'Server Error') },
    undefined,
    undefined,
    {
      report: (_failure, needed) => {
        told.push(needed);
        return true;
      },
    },
  );
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(useToasts.getState().toasts).not.toEqual([]);
  });
  expect(told).toEqual([]);
});

it('reports a 428 as a fault in the console, not a refusal of the person', async () => {
  const user = userEvent.setup();
  mount({
    [GET]: client(LOADED, '"e1"'),
    [PATCH]: problem(428, 'about:blank', 'Precondition Required', {
      detail: 'If-Match is required to replace client',
    }),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        message:
          'The console could not save General. This is a fault in the console, not something you did.',
      }),
    ]);
  });
});

it('says a kept draft only differs from the record now, not that somebody changed each field', async () => {
  storeDrafts({
    owner: 'acme/s1',
    drafts: { 'acme/clients/c1': { general: { etag: '"e0"', values: { name: 'Billing' } } } },
  });
  mount({ [GET]: client(LOADED, '"e1"'), [PATCH]: pending() });
  await waitFor(() => {
    expect(announced()).toHaveTextContent(
      'General changed since these edits were kept: Name. Compare them, then keep yours or take theirs.',
    );
  });
});

function Both({ data, etag }: { data: Client; etag: string }) {
  const save = useSectionSave({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'both',
    label: 'Both',
    etag,
    capability: 'manage-clients',
    refusal: NO_REFUSAL,
    fields: {
      name: { value: data.name, label: 'Name', kind: 'plain' },
      access_token_ttl: { value: data.access_token_ttl, label: 'Lifetime', kind: 'plain' },
    },
    save: (gateway, { changes, ifMatch }) => amend(gateway, changes, ifMatch),
  });
  return (
    <Section
      title="Both"
      dirty={save.dirty}
      saving={save.saving}
      onSave={save.submit}
      onDiscard={save.discard}
      blocked={save.blocked}
      notice={
        <SectionNotice
          section="Both"
          status={save.status}
          conflicts={save.conflicts}
          conflictSource={save.conflictSource}
          message={save.message}
          busy={save.saving}
          onKeepMine={save.keepMine}
          onTakeTheirs={save.takeTheirs}
        />
      }
    >
      <TextField
        label="Name"
        value={save.values.name}
        onChange={(name) => {
          save.edit('name', name);
        }}
      />
      <NumberWithUnitField
        label="Lifetime"
        unit="seconds"
        value={save.values.access_token_ttl}
        onChange={(ttl) => {
          save.edit('access_token_ttl', ttl);
        }}
      />
    </Section>
  );
}

it('saves the edits left after taking theirs, and keeps focus in the section', async () => {
  const user = userEvent.setup();
  const fake = fakeTransport({
    [GET]: inTurn(client(LOADED, '"e1"'), client({ ...LOADED, name: 'Payments' }, '"e2"')),
    [PATCH]: inTurn(
      problem(412, 'about:blank', 'Precondition Failed'),
      client({ name: 'Payments', access_token_ttl: 900 }, '"e3"'),
    ),
  });
  function Page() {
    const record = useRecord({ tenant: 'acme', record: 'clients/c1', read });
    if (record.data === undefined || record.etag === null) return null;
    return <Both data={record.data} etag={record.etag} />;
  }
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={createReadCache()}>
        <Page />
      </QueryClientProvider>
    </TransportContext>,
  );
  const region = await screen.findByRole('region', { name: 'Both' });
  await user.clear(within(region).getByRole('textbox', { name: 'Name' }));
  await user.type(within(region).getByRole('textbox', { name: 'Name' }), 'Billing');
  const ttl = within(region).getByRole('textbox', { name: 'Lifetime' });
  await user.clear(ttl);
  await user.type(ttl, '900');
  await user.tab();
  await user.click(within(region).getByRole('button', { name: 'Save Both' }));
  await user.click(await within(region).findByRole('button', { name: 'Take theirs in Both' }));
  expect(within(region).getByRole('heading', { name: 'Both' })).toHaveFocus();

  await user.type(within(region).getByRole('textbox', { name: 'Lifetime' }), '{Enter}');
  await waitFor(() => {
    expect(fake.sent.filter((request) => request.method === 'PATCH')).toHaveLength(2);
  });
  expect(fake.sent.filter((request) => request.method === 'PATCH')[1]).toEqual(
    expect.objectContaining({ ifMatch: '"e2"', body: { access_token_ttl: 900 } }),
  );
});

it('keeps the edits and their guard when a refetch on focus fails', async () => {
  const user = userEvent.setup();
  const { queryClient, reads } = mount({
    [GET]: inTurn(client(LOADED, '"e1"'), () => {
      throw new TypeError('Failed to fetch');
    }),
    [PATCH]: pending(),
  });
  await rename(user, 'Billing');
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: recordKey('acme', 'clients/c1') });
  });
  expect(reads()).toBe(4);
  // The query client tells its observers on a later task.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  expect(within(general()).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing');
  expect(useUnsavedGuard.getState().unsaved()).toEqual(['General']);
});

it('holds Save when the newer version a 412 points at could not be loaded, until it is', async () => {
  const user = userEvent.setup();
  const { patches } = mount({
    [GET]: inTurn(
      client(LOADED, '"e1"'),
      problem(500, 'about:blank', 'Internal Server Error'),
      client({ ...LOADED, access_token_ttl: 600 }, '"e2"'),
    ),
    [PATCH]: inTurn(problem(412, 'about:blank', 'Precondition Failed'), pending()),
  });
  await rename(user, 'Billing');
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(announced()).toHaveTextContent(
      'General changed elsewhere, and its newer version could not be loaded. Nothing was saved; load it before saving again.',
    );
  });
  expect(announced()).not.toHaveTextContent('save again to apply them');
  expect(within(announced()).queryByRole('button')).toBeNull();
  const save = within(general()).getByRole('button', { name: 'Save General' });
  expect(save).toBeDisabled();
  expect(save).toHaveAccessibleDescription('Load the newer version before saving.');

  await user.click(
    within(general()).getByRole('button', { name: 'Load the newer version of General' }),
  );
  await waitFor(() => {
    expect(announced()).toHaveTextContent('save again to apply them');
  });
  await user.click(within(general()).getByRole('button', { name: 'Save General' }));
  await waitFor(() => {
    expect(patches()).toHaveLength(2);
  });
  expect(patches()[1]).toEqual(expect.objectContaining({ ifMatch: '"e2"' }));
});

it('holds Save, saying why, once the record is found deleted', async () => {
  const user = userEvent.setup();
  const { queryClient, patches } = mount({
    [GET]: inTurn(client(LOADED, '"e1"'), problem(404, 'about:blank#not-found', 'Not Found')),
    [PATCH]: pending(),
  });
  await rename(user, 'Billing');
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: recordKey('acme', 'clients/c1') });
  });
  const save = await within(general()).findByRole('button', { name: 'Save General' });
  await waitFor(() => {
    expect(save).toBeDisabled();
  });
  expect(save).toHaveAccessibleDescription(
    'This record was deleted since you opened it, so there is nothing to save to.',
  );
  await user.type(within(general()).getByRole('textbox', { name: 'Name' }), '{Enter}');
  expect(patches()).toEqual([]);
  expect(within(general()).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing');
});

// The section's own handlers, called as the hook hands them out: what Save
// and the conflict buttons do is theirs to decide, whatever the view offers.
function Direct({ data, etag, gone }: { data: Client; etag: string; gone: boolean }) {
  const save = useSectionSave({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'general',
    label: 'General',
    etag,
    capability: 'manage-clients',
    gone,
    refusal: NO_REFUSAL,
    fields: {
      name: { value: data.name, label: 'Name', kind: 'plain' },
      access_token_ttl: { value: data.access_token_ttl, label: 'TTL', kind: 'plain' },
    },
    save: (gateway, { changes, ifMatch }) => amend(gateway, changes, ifMatch),
  });
  const [answer, setAnswer] = useState('');
  return (
    <>
      <input
        aria-label="Name"
        value={save.values.name}
        onChange={(event) => {
          save.edit('name', event.target.value);
        }}
      />
      <button
        type="button"
        onClick={() => {
          save.edit('access_token_ttl', 900);
        }}
      >
        Edit TTL
      </button>
      <button
        type="button"
        onClick={() => {
          setAnswer(String(save.submit()));
        }}
      >
        Submit
      </button>
      <button type="button" onClick={save.keepMine}>
        Keep
      </button>
      <button type="button" onClick={save.takeTheirs}>
        Take
      </button>
      <p>{`status ${save.status}`}</p>
      <p>{`restored ${String(save.restored)}`}</p>
      <p>{`submitted ${answer}`}</p>
    </>
  );
}

function DirectRecord() {
  const record = useRecord({ tenant: 'acme', record: 'clients/c1', read });
  if (record.data === undefined || record.etag === null) return <p>Loading</p>;
  return <Direct data={record.data} etag={record.etag} gone={record.gone} />;
}

function mountDirect(routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const queryClient = createReadCache();
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={queryClient}>
        <DirectRecord />
      </QueryClientProvider>
    </TransportContext>,
  );
  return { queryClient, patches: () => fake.sent.filter((request) => request.method === 'PATCH') };
}

const KEPT_AGAINST_OLDER = {
  owner: 'acme/s1',
  drafts: { 'acme/clients/c1': { general: { etag: '"e0"', values: { name: 'Billing' } } } },
};

it('declines to submit while a conflict is open, and answers false', async () => {
  const user = userEvent.setup();
  storeDrafts(KEPT_AGAINST_OLDER);
  const { patches } = mountDirect({ [GET]: client(LOADED, '"e1"'), [PATCH]: pending() });
  await screen.findByText('status conflict');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(screen.getByText('submitted false')).toBeVisible();
  expect(patches()).toEqual([]);
});

it('keeps its edits only to settle a conflict, and sends nothing without one', async () => {
  const user = userEvent.setup();
  const { patches } = mountDirect({ [GET]: client(LOADED, '"e1"'), [PATCH]: pending() });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' EU');
  await user.click(screen.getByRole('button', { name: 'Keep' }));
  expect(patches()).toEqual([]);
});

it('settles a kept draft once taking theirs leaves nothing of it, so a later edit is not marked restored', async () => {
  const user = userEvent.setup();
  storeDrafts(KEPT_AGAINST_OLDER);
  mountDirect({ [GET]: client(LOADED, '"e1"'), [PATCH]: pending() });
  await screen.findByText('status conflict');
  await user.click(screen.getByRole('button', { name: 'Take' }));
  await screen.findByText('status idle');
  await user.type(screen.getByRole('textbox', { name: 'Name' }), ' EU');
  expect(screen.getByText('restored false')).toBeVisible();
});

it('does not call a kept draft restored when it holds nothing that differs from the record', async () => {
  storeDrafts({
    owner: 'acme/s1',
    drafts: {
      'acme/clients/c1': { general: { etag: '"e1"', values: { name: 'Billing portal' } } },
    },
  });
  mountDirect({ [GET]: client(LOADED, '"e1"'), [PATCH]: pending() });
  await screen.findByText('status idle');
  expect(screen.getByText('restored false')).toBeVisible();
});

it('sends one request at a time whatever calls submit again while it is in flight', async () => {
  const user = userEvent.setup();
  const { patches } = mountDirect({ [GET]: client(LOADED, '"e1"'), [PATCH]: pending() });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' EU');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(patches()).toHaveLength(1);
  expect(screen.getByText('submitted false')).toBeVisible();
});

it('leaves a section as it is when taking theirs is asked with nothing in conflict', async () => {
  const user = userEvent.setup();
  mountDirect({
    [GET]: inTurn(client(LOADED, '"e1"'), problem(500, 'about:blank', 'Internal Server Error')),
    [PATCH]: problem(412, 'about:blank', 'Precondition Failed'),
  });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' EU');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByText('status unread');
  await user.click(screen.getByRole('button', { name: 'Take' }));
  expect(screen.getByText('status unread')).toBeVisible();
});

it('keeps a kept draft marked restored while taking theirs leaves edits of its own', async () => {
  const user = userEvent.setup();
  storeDrafts(KEPT_AGAINST_OLDER);
  mountDirect({ [GET]: client(LOADED, '"e1"'), [PATCH]: pending() });
  await screen.findByText('status conflict');
  await user.click(screen.getByRole('button', { name: 'Edit TTL' }));
  await user.click(screen.getByRole('button', { name: 'Take' }));
  await screen.findByText('status idle');
  expect(screen.getByText('restored true')).toBeVisible();
});

it('sends nothing for a record found deleted, and answers false', async () => {
  const user = userEvent.setup();
  const { patches, queryClient } = mountDirect({
    [GET]: inTurn(client(LOADED, '"e1"'), problem(404, 'about:blank#not-found', 'Not Found')),
    [PATCH]: pending(),
  });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' EU');
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: recordKey('acme', 'clients/c1') });
  });
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(screen.getByText('submitted false')).toBeVisible();
  expect(patches()).toEqual([]);
});
