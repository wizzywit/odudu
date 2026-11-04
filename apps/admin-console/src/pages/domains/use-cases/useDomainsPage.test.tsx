import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useDomainsPage } from '#/pages/domains/use-cases/useDomainsPage';
import {
  ADDRESS,
  DOMAINS,
  domain,
  domainRoutes,
  IMPACT,
  listAnswer,
  PENDING,
  VERIFIED,
} from '#/testing/domainsFixtures';
import { inTurn, json, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

function page(
  extra: Parameters<typeof domainRoutes>[1] = {},
  capabilities?: Parameters<typeof domainRoutes>[0],
  items?: Parameters<typeof domainRoutes>[2],
) {
  const harness = hookHarness(domainRoutes(capabilities, extra, items));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return { ...harness, ...renderHook(() => useDomainsPage('acme'), { wrapper }) };
}

async function read(result: { current: ReturnType<typeof useDomainsPage> }) {
  await waitFor(() => {
    expect(result.current.record.status).toBe('ready');
  });
}

it('reads the domains once, with the tenant’s tag, and offers each its actions', async () => {
  const { result, sent } = page();
  await read(result);
  expect(result.current.title).toBe('Domains');
  expect(result.current.rows.map((row) => row.domain.id)).toEqual(['pending', 'login', 'lost']);
  expect(result.current.record.etag).toBe('"path"');
  expect(sent.filter((request) => request.path === DOMAINS)).toHaveLength(1);
});

it('sends the tenant’s tag with an activation and reads the domains again', async () => {
  const { result, sent } = page({
    [`POST ${DOMAINS}/login/activate`]: json({ ...VERIFIED, canonical: true }, 200, {
      etag: '"login"',
    }),
  });
  await read(result);
  act(() => {
    result.current.action.ask('activate', VERIFIED);
  });
  await waitFor(() => {
    expect(sent.some((request) => request.path === IMPACT)).toBe(true);
  });
  expect(sent.find((request) => request.path === IMPACT)?.search.get('canonical')).toBe(
    'login.acme.com',
  );
  await waitFor(() => {
    expect(result.current.action.held).toBe(false);
  });
  await act(async () => {
    await result.current.action.confirm();
  });
  const post = sent.find((request) => request.method === 'POST');
  expect(post?.ifMatch).toBe('"path"');
  expect(result.current.action.notice).toBe('login.acme.com is now the tenant’s address.');
  expect(result.current.action.asking).toBeNull();
  await waitFor(() => {
    expect(
      sent.filter((request) => request.path === DOMAINS && request.method === 'GET'),
    ).toHaveLength(2);
  });
});

it('holds an activation until the passkeys it hides are acknowledged, then sends it', async () => {
  const { result, sent } = page({
    [`GET ${IMPACT}`]: json({ subjects: 3, capped: false }),
    [`POST ${DOMAINS}/login/activate`]: json({ ...VERIFIED, canonical: true }),
  });
  await read(result);
  act(() => {
    result.current.action.ask('activate', VERIFIED);
  });
  await waitFor(() => {
    expect(result.current.action.asking?.dialog.choice).toBeDefined();
  });
  expect(result.current.action.held).toBe(true);
  await act(async () => {
    expect(await result.current.action.confirm()).toBe(false);
  });
  expect(sent.some((request) => request.method === 'POST')).toBe(false);
  act(() => {
    result.current.action.acknowledge(true);
  });
  expect(result.current.action.held).toBe(false);
  await act(async () => {
    expect(await result.current.action.confirm()).toBe(true);
  });
  expect(sent.some((request) => request.method === 'POST')).toBe(true);
});

it('asks for the acknowledgement afresh each time a switch is asked for', async () => {
  const { result } = page({ [`GET ${IMPACT}`]: json({ subjects: 3, capped: false }) });
  await read(result);
  act(() => {
    result.current.action.ask('activate', VERIFIED);
  });
  await waitFor(() => {
    expect(result.current.action.asking?.dialog.choice).toBeDefined();
  });
  act(() => {
    result.current.action.acknowledge(true);
  });
  act(() => {
    result.current.action.cancel();
  });
  act(() => {
    result.current.action.ask('activate', VERIFIED);
  });
  expect(result.current.action.acknowledged).toBe(false);
});

it('rebases on a stale tag: closes the dialog, reads again, and the next try carries the new tag', async () => {
  const { result, sent } = page({
    [`GET ${DOMAINS}`]: inTurn(listAnswer([VERIFIED], '"a"'), listAnswer([VERIFIED], '"b"')),
    [`POST ${DOMAINS}/login/activate`]: inTurn(
      problem(412, 'about:blank', 'Precondition Failed'),
      json({ ...VERIFIED, canonical: true }),
    ),
  });
  await read(result);
  act(() => {
    result.current.action.ask('activate', VERIFIED);
  });
  await waitFor(() => {
    expect(result.current.action.held).toBe(false);
  });
  await act(async () => {
    expect(await result.current.action.confirm()).toBe(false);
  });
  expect(result.current.action.asking).toBeNull();
  expect(result.current.action.notice).toContain('changed');
  await waitFor(() => {
    expect(result.current.record.etag).toBe('"b"');
  });
  act(() => {
    result.current.action.ask('activate', VERIFIED);
  });
  await waitFor(() => {
    expect(result.current.action.held).toBe(false);
  });
  await act(async () => {
    await result.current.action.confirm();
  });
  const posts = sent.filter((request) => request.method === 'POST');
  expect(posts.map((request) => request.ifMatch)).toEqual(['"a"', '"b"']);
});

it('switches back from an address whose domain has failed', async () => {
  const failedAddress = domain('www', 'failed', { canonical: true });
  const { result, sent } = page(
    { [`POST ${DOMAINS}/www/deactivate`]: json(failedAddress, 200, { etag: '"path"' }) },
    undefined,
    [failedAddress],
  );
  await read(result);
  expect(result.current.rows[0]?.actions).toEqual(['deactivate']);
  act(() => {
    result.current.action.ask('deactivate', failedAddress);
  });
  await waitFor(() => {
    expect(result.current.action.held).toBe(false);
  });
  expect(sent.find((request) => request.path === IMPACT)?.search.get('canonical')).toBe('path');
  await act(async () => {
    await result.current.action.confirm();
  });
  expect(result.current.action.notice).toBe('The tenant signs in at its path address again.');
});

it('names manage-domains when the server refuses a removal', async () => {
  const { result } = page({
    [`DELETE ${DOMAINS}/login`]: problem(403, 'about:blank', 'Forbidden'),
  });
  await read(result);
  act(() => {
    result.current.action.ask('remove', VERIFIED);
  });
  await act(async () => {
    await result.current.action.confirm();
  });
  expect(result.current.action.problem).toContain('manage-domains');
  expect(result.current.action.asking).not.toBeNull();
});

it('says why a verification did not land, and does not say it is done', async () => {
  const { result } = page({
    [`POST ${DOMAINS}/pending/verify`]: problem(409, 'about:blank#domain-failed', 'Conflict'),
  });
  await read(result);
  await act(async () => {
    await result.current.verify.run(PENDING);
  });
  expect(result.current.verify.message).toContain('Publish the record again');
});

it('says a verification that finds no record yet leaves the domain as it was', async () => {
  const { result } = page({ [`POST ${DOMAINS}/pending/verify`]: json(PENDING) });
  await read(result);
  await act(async () => {
    await result.current.verify.run(PENDING);
  });
  expect(result.current.verify.message).toContain('does not show its record yet');
});

it('clears a verification message once the next one lands', async () => {
  const { result } = page({
    [`POST ${DOMAINS}/pending/verify`]: inTurn(
      problem(429, 'about:blank#domain-verify-throttled', 'Too Many Requests'),
      json({ ...PENDING, state: 'verified' }),
    ),
  });
  await read(result);
  await act(async () => {
    await result.current.verify.run(PENDING);
  });
  expect(result.current.verify.message).toContain('too recently');
  await act(async () => {
    await result.current.verify.run(PENDING);
  });
  expect(result.current.verify.message).toBeNull();
});

it('blocks a blank host with its text, and sends nothing', async () => {
  const { result, sent } = page();
  await read(result);
  act(() => {
    result.current.register.start();
  });
  expect(result.current.register.error).toBe(
    'Enter the host the tenant will sign in at, such as login.acme.com.',
  );
  expect(sent.some((request) => request.method === 'POST')).toBe(false);
});

it('registers the host typed, empties the field and reads the domains again', async () => {
  const { result, sent } = page({
    [`POST ${DOMAINS}`]: json(PENDING, 201, { etag: '"path"' }),
  });
  await read(result);
  act(() => {
    result.current.register.edit(' pending.acme.com ');
  });
  act(() => {
    result.current.register.start();
  });
  await waitFor(() => {
    expect(result.current.register.host).toBe('');
  });
  expect(sent.find((request) => request.method === 'POST')?.body).toEqual({
    host: 'pending.acme.com',
  });
});

it('keeps the host and puts the server’s refusal under it', async () => {
  const { result } = page({
    [`POST ${DOMAINS}`]: problem(422, 'about:blank#domain-host-invalid', 'Unprocessable Content', {
      detail: 'the host is not a name',
    }),
  });
  await read(result);
  act(() => {
    result.current.register.edit('Login.ACME.com');
  });
  act(() => {
    result.current.register.start();
  });
  await waitFor(() => {
    expect(result.current.register.error).toBe('The host is not a name.');
  });
  expect(result.current.register.host).toBe('Login.ACME.com');
});

it('says what the caller may not do when it holds only view-domains', async () => {
  const { result } = page({}, ['view-domains']);
  await read(result);
  await waitFor(() => {
    expect(result.current.needs).not.toBeNull();
  });
  expect(result.current.needs?.needs).toEqual(['manage-domains']);
});

it('says the tenant signs in at the address it holds', async () => {
  const { result } = page({}, undefined, [ADDRESS]);
  await read(result);
  expect(result.current.address).toBe('This tenant signs in at www.acme.com.');
});
