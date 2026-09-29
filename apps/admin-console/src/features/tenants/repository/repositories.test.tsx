import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFirstAdministrator } from '#/features/tenants/repository/useCreation.ts';
import { useExport } from '#/features/tenants/repository/useExport.ts';
import { useImport } from '#/features/tenants/repository/useImport.ts';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { fakeTransport, json, problem, type Answer } from '#/testing/fakeTransport.ts';

const T = '/console/api/admin/tenants/acme';
const SUBJECT_ID = '01a0e72d-7fc7-7950-a1e7-1d079588f8b4';
const PASSWORD = 'one-time-Qm9vYmFy';
const SECRET = 'client-secret-c2VjcmV0';
const TENANT = {
  id: '01a0e72d-7fc7-7950-a1e7-1d079588f8b5',
  name: 'acme',
  display_name: null,
  enabled: true,
  created_at: '2026-09-28T08:41:53.858Z',
};

function harness(routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportContext>
  );
  return { ...fake, queryClient, wrapper };
}

function cached(queryClient: QueryClient): string {
  return JSON.stringify([
    queryClient
      .getMutationCache()
      .getAll()
      .map((m) => m.state),
    queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.state),
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function administratorRoutes(): Record<string, Answer> {
  return {
    [`POST ${T}/subjects`]: json(
      {
        id: SUBJECT_ID,
        type: 'user',
        username: 'grace',
        email: null,
        enabled: true,
        created_at: '2026-09-28T08:41:53.858Z',
      },
      201,
    ),
    [`GET ${T}/clients`]: json({
      items: [
        { id: 'c-copy', builtin_admin: false },
        { id: 'c-admin', builtin_admin: true },
      ].map((client) => ({ ...clientDefaults, ...client })),
    }),
    [`GET ${T}/roles`]: json({
      items: [
        {
          id: 'r-admin',
          name: 'tenant-admin',
          description: null,
          client_id: 'c-admin',
          client_key: 'odudu-admin',
          default_for_new_subjects: false,
          created_at: '2026-09-28T08:41:53.858Z',
        },
      ],
    }),
    [`GET ${T}/subjects/${SUBJECT_ID}/roles`]: json(
      { items: [{ id: 'r-default', name: 'reader', client_id: null, client_key: null }] },
      200,
      { etag: '"roles-1"' },
    ),
    [`PUT ${T}/subjects/${SUBJECT_ID}/roles`]: json({ items: [] }, 200, { etag: '"roles-2"' }),
    [`POST ${T}/subjects/${SUBJECT_ID}/password`]: json({ password: PASSWORD }, 201),
  };
}

const clientDefaults = {
  client_id: 'odudu-admin',
  name: 'Odudu admin',
  type: 'public',
  enabled: true,
  full_scope_allowed: false,
  registration_origin: 'seeded',
  created_at: '2026-09-28T08:41:53.858Z',
  redirect_uris: [],
  grant_types: [],
  token_endpoint_auth_method: 'none',
  audiences: [],
  access_token_ttl_seconds: 300,
  refresh_token_ttl_seconds: 3600,
  client_credentials_scopes: [],
  web_origins: [],
  post_logout_redirect_uris: [],
  jwks: null,
  jwks_uri: null,
  frontchannel_logout_uri: null,
  backchannel_logout_uri: null,
  frontchannel_logout_session_required: false,
  backchannel_logout_session_required: false,
  consent_required: false,
  token_exchange_impersonation_allowed: false,
  userinfo_signed_response_alg: null,
  userinfo_encrypted_response_alg: null,
  userinfo_encrypted_response_enc: null,
  tls_client_auth_subject_dn: null,
  service_subject_id: null,
  scopes: [],
};

it('creates the administrator, grants tenant-admin on the built-in client, then issues the password', async () => {
  const { wrapper, sent, queryClient } = harness(administratorRoutes());
  const progress = vi.fn();
  const { result } = renderHook(() => useFirstAdministrator(), { wrapper });
  act(() => {
    result.current.start({
      tenant: 'acme',
      username: 'grace',
      email: '',
      subjectId: null,
      granted: false,
      onProgress: progress,
    });
  });
  await waitFor(() => {
    expect(result.current.secret).toBe(PASSWORD);
  });
  expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
    `POST ${T}/subjects`,
    `GET ${T}/clients`,
    `GET ${T}/roles`,
    `GET ${T}/subjects/${SUBJECT_ID}/roles`,
    `PUT ${T}/subjects/${SUBJECT_ID}/roles`,
    `POST ${T}/subjects/${SUBJECT_ID}/password`,
  ]);
  expect(sent[2]?.search.toString()).toBe('client=c-admin&name=tenant-admin');
  expect(sent[4]).toMatchObject({
    ifMatch: '"roles-1"',
    body: { role_ids: ['r-default', 'r-admin'] },
  });
  expect(progress.mock.calls).toEqual([
    [{ subjectId: SUBJECT_ID, granted: false }],
    [{ subjectId: SUBJECT_ID, granted: true }],
  ]);
  expect(cached(queryClient)).not.toContain(PASSWORD);
});

it('resumes where a reload left it: a granted subject is only issued its password', async () => {
  const { wrapper, sent } = harness(administratorRoutes());
  const { result } = renderHook(() => useFirstAdministrator(), { wrapper });
  act(() => {
    result.current.start({
      tenant: 'acme',
      username: 'grace',
      email: '',
      subjectId: SUBJECT_ID,
      granted: true,
      onProgress: () => undefined,
    });
  });
  await waitFor(() => {
    expect(result.current.secret).toBe(PASSWORD);
  });
  expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
    `POST ${T}/subjects/${SUBJECT_ID}/password`,
  ]);
});

it('stops at a refused call, reporting it, with what landed already told', async () => {
  const routes = administratorRoutes();
  routes[`PUT ${T}/subjects/${SUBJECT_ID}/roles`] = problem(403, 'about:blank', 'Forbidden');
  const { wrapper, sent } = harness(routes);
  const progress = vi.fn();
  const { result } = renderHook(() => useFirstAdministrator(), { wrapper });
  act(() => {
    result.current.start({
      tenant: 'acme',
      username: 'grace',
      email: '',
      subjectId: null,
      granted: false,
      onProgress: progress,
    });
  });
  await waitFor(() => {
    expect(result.current.failure).not.toBeNull();
  });
  expect(result.current.secret).toBeNull();
  expect(progress.mock.calls).toEqual([[{ subjectId: SUBJECT_ID, granted: false }]]);
  expect(sent.some((s) => s.path.endsWith('/password'))).toBe(false);
});

it('saves an export as the bytes the server sent, and keeps the text nowhere', async () => {
  const text = '{"version":1,"newer_member":{"ü":"𝄞"},"omitted":["smtp.password"]}';
  const saved: string[] = [];
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
  const { wrapper, queryClient } = harness({
    [`GET ${T}/export`]: () =>
      new Response(text, { headers: { 'content-type': 'application/vnd.odudu.tenant+json' } }),
  });
  const { result } = renderHook(() => useExport('acme', () => new Date('2026-09-29T10:00:00Z')), {
    wrapper,
  });
  let answer: unknown;
  await act(async () => {
    answer = await result.current.start(false);
  });
  expect(answer).toMatchObject({
    ok: true,
    data: {
      fileName: 'acme-2026-09-29.odudu-tenant.json',
      bytes: new TextEncoder().encode(text).length,
      omitted: ['smtp.password'],
    },
  });
  expect(saved).toEqual(['acme-2026-09-29.odudu-tenant.json']);
  expect(cached(queryClient)).not.toContain('newer_member');
});

it('shows each imported secret once, one at a time, and keeps them out of every cache', async () => {
  const { wrapper, queryClient, sent } = harness({
    'POST /console/api/admin/tenant-imports': json(
      {
        tenant: TENANT,
        client_secrets: [
          { client_id: 'web', secret: `${SECRET}-1` },
          { client_id: 'api', secret: `${SECRET}-2` },
        ],
      },
      201,
    ),
  });
  const { result } = renderHook(() => useImport(), { wrapper });
  const file = new File(['{"version":1}'], 'acme.json');
  act(() => {
    result.current.start({ name: 'acme', displayName: '', file });
    result.current.start({ name: 'acme', displayName: '', file });
  });
  await waitFor(() => {
    expect(result.current.secret).toEqual({ clientId: 'web', secret: `${SECRET}-1` });
  });
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toEqual({ name: 'acme', document: { version: 1 } });
  expect(result.current.outcome).toEqual({ ok: true, tenant: TENANT, secrets: 2 });
  expect(cached(queryClient)).not.toContain(SECRET);

  act(() => {
    result.current.close();
  });
  expect(result.current.secret).toEqual({ clientId: 'api', secret: `${SECRET}-2` });
  expect(result.current.shown).toBe(1);
  act(() => {
    result.current.close();
  });
  expect(result.current.secret).toBeNull();
  expect(JSON.stringify(result.current)).not.toContain(SECRET);
  expect(cached(queryClient)).not.toContain(SECRET);
});

it('refuses a file that is not JSON without sending anything', async () => {
  const { wrapper, sent } = harness({});
  const { result } = renderHook(() => useImport(), { wrapper });
  act(() => {
    result.current.start({ name: 'acme', displayName: '', file: new File(['{'], 'x.json') });
  });
  await waitFor(() => {
    expect(result.current.outcome).toEqual({
      ok: false,
      kind: 'file',
      message: 'The file is not JSON, so it cannot be a tenant document.',
    });
  });
  expect(sent).toHaveLength(0);
});
