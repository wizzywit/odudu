import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useDrafts, type DraftFields } from '#/shared/lib/repository/useDrafts';
import { useSectionDraft } from '#/shared/lib/repository/useSectionDraft';
import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';
import { TextField } from '#/shared/ui/Field';
import { Section } from '#/shared/ui/Section';
import { json, SESSION_ENDED, type Answer } from '#/testing/fakeTransport';
import { mountGuardedPage } from '#/testing/mountGuardedPage';
import { resetConsole } from '#/testing/resetConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const BASE = { name: 'Billing portal', secret: '' };

// A client section as a feature will build one, on a route of its own.
function General() {
  const [edits, setEdits] = useState<Partial<typeof BASE>>({});
  const fields: DraftFields = Object.fromEntries(
    Object.entries(edits).map(([name, value]) => [
      name,
      { kind: name === 'secret' ? 'secret' : 'plain', value } as const,
    ]),
  );
  const dirty = Object.keys(edits).length > 0;
  const { restored, settle } = useSectionDraft({
    tenant: 'acme',
    record: 'clients/c1',
    section: 'general',
    label: 'General',
    dirty,
    fields,
    etag: '"e1"',
  });
  const [applied, setApplied] = useState(false);
  if (restored !== null && !applied) {
    setApplied(true);
    setEdits(typeof restored.values.name === 'string' ? { name: restored.values.name } : {});
  }
  const values = { ...BASE, ...edits };
  return (
    <Section
      title="General"
      dirty={dirty}
      saving={false}
      restored={restored !== null}
      onSave={() => undefined}
      onDiscard={() => {
        setEdits({});
        settle();
      }}
    >
      <TextField
        label="Name"
        value={values.name}
        onChange={(name) => {
          setEdits((was) => ({ ...was, name }));
        }}
      />
      <TextField
        label="Client secret"
        value={values.secret}
        onChange={(secret) => {
          setEdits((was) => ({ ...was, secret }));
        }}
      />
    </Section>
  );
}

function mount(routes: Record<string, Answer>) {
  return mountGuardedPage(routes, General);
}

const SIGNED_IN = {
  'GET /console/api/session': json({ tenant: 'acme', subject_id: 's1', username: 'grace' }),
  [`GET ${ACME_ADMIN}/whoami`]: json({
    subjectId: 's1',
    issuerTenantId: 't1',
    capabilities: ['manage-clients'],
    crossTenant: false,
  }),
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  resetConsole();
});

it('keeps the edit through a session that ends mid-edit, and puts it back marked, sending nothing', async () => {
  const user = userEvent.setup();
  const first = mount({
    ...SIGNED_IN,
    [`GET ${ACME_ADMIN}/clients`]: SESSION_ENDED,
  });
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await user.type(name, ' EU');
  await user.type(screen.getByRole('textbox', { name: 'Client secret' }), 'hunter2');

  await act(() =>
    first.transport.gateway.request('GET', 'admin/tenants/acme/clients', { schema: z.unknown() }),
  );

  await waitFor(() => {
    expect(first.leavePage).toHaveBeenCalledOnce();
  });
  const login = new URL(first.leavePage.mock.calls[0]?.[0] ?? '', location.origin);
  expect(login.pathname).toBe('/console/auth/login');
  expect(login.searchParams.get('return_to')).toBe('/console/acme/clients/c1');
  expect(screen.getByRole('heading', { level: 1, name: 'Your session ended' })).toBeVisible();
  const kept = sessionStorage.getItem('odudu.console.drafts') ?? '';
  expect(kept).toContain('Billing portal EU');
  expect(kept).not.toContain('hunter2');
  expect(first.calls.every((call) => call.method === 'GET')).toBe(true);
  first.unmount();

  const second = mount(SIGNED_IN);
  const section = await screen.findByRole('region', { name: 'General' });
  expect(within(section).getByText('Restored — review before saving')).toBeVisible();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal EU');
  expect(within(section).getByRole('textbox', { name: 'Client secret' })).toHaveValue('');
  expect(second.calls.every((call) => call.method === 'GET')).toBe(true);
});

it('drops a question about leaving that the end of the session overtook, without answering it', async () => {
  const user = userEvent.setup();
  const first = mount({
    ...SIGNED_IN,
    [`GET ${ACME_ADMIN}/clients`]: SESSION_ENDED,
  });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' EU');
  const proceed = vi.fn();
  expect(useUnsavedGuard.getState().request(proceed)).toBe(false);

  await act(() =>
    first.transport.gateway.request('GET', 'admin/tenants/acme/clients', { schema: z.unknown() }),
  );

  await waitFor(() => {
    expect(first.leavePage).toHaveBeenCalledOnce();
  });
  expect(useUnsavedGuard.getState().pending).toBeNull();
  expect(proceed).not.toHaveBeenCalled();
});

it('forgets what a restored section kept again once its edits are discarded', async () => {
  const user = userEvent.setup();
  sessionStorage.setItem(
    'odudu.console.drafts',
    JSON.stringify({
      owner: 'acme/s1',
      drafts: {
        'acme/clients/c1': { general: { etag: '"e1"', values: { name: 'Billing portal EU' } } },
      },
    }),
  );
  mount(SIGNED_IN);
  const section = await screen.findByRole('region', { name: 'General' });
  expect(within(section).getByText('Restored — review before saving')).toBeVisible();
  expect(sessionStorage.getItem('odudu.console.drafts')).toBeNull();
  act(() => {
    useDrafts.getState().keepDirty('acme/s1');
  });
  expect(sessionStorage.getItem('odudu.console.drafts') ?? '').toContain('Billing portal EU');
  await user.click(within(section).getByRole('button', { name: /Discard/u }));
  expect(sessionStorage.getItem('odudu.console.drafts')).toBeNull();
});

it('restores nothing for a different administrator signing in to the same tab', async () => {
  const user = userEvent.setup();
  const first = mount({
    ...SIGNED_IN,
    [`GET ${ACME_ADMIN}/clients`]: SESSION_ENDED,
  });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' EU');
  await act(() =>
    first.transport.gateway.request('GET', 'admin/tenants/acme/clients', { schema: z.unknown() }),
  );
  await waitFor(() => {
    expect(first.leavePage).toHaveBeenCalled();
  });
  first.unmount();

  mount({
    ...SIGNED_IN,
    'GET /console/api/session': json({ tenant: 'acme', subject_id: 's2', username: 'hopper' }),
  });
  const section = await screen.findByRole('region', { name: 'General' });
  expect(within(section).queryByText('Restored — review before saving')).toBeNull();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal');
});

const ROOT_IN_ACME = {
  'GET /console/api/session': json({ tenant: 'system', subject_id: 's0', username: 'root' }),
  [`GET ${ACME_ADMIN}/whoami`]: json({
    subjectId: 's0',
    issuerTenantId: 't0',
    capabilities: ['manage-clients', 'manage-tenants'],
    crossTenant: true,
  }),
};

it("sends a system administrator whose session ends inside another tenant to system's sign-in, and back", async () => {
  const user = userEvent.setup();
  const first = mount({
    ...ROOT_IN_ACME,
    [`GET ${ACME_ADMIN}/clients`]: SESSION_ENDED,
  });
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' EU');

  await act(() =>
    first.transport.gateway.request('GET', 'admin/tenants/acme/clients', { schema: z.unknown() }),
  );

  await waitFor(() => {
    expect(first.leavePage).toHaveBeenCalledOnce();
  });
  const login = new URL(first.leavePage.mock.calls[0]?.[0] ?? '', location.origin);
  expect(login.searchParams.get('tenant')).toBe('system');
  expect(login.searchParams.get('return_to')).toBe('/console/acme/clients/c1');
  expect(screen.getByRole('status')).toHaveTextContent("Taking you to system's sign-in…");
  expect(sessionStorage.getItem('odudu.console.drafts') ?? '').toContain('"owner":"system/s0"');
  first.unmount();

  mount(ROOT_IN_ACME);
  const section = await screen.findByRole('region', { name: 'General' });
  expect(within(section).getByText('Restored — review before saving')).toBeVisible();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal EU');
});
