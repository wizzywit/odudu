import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignedInContext, useAuthorityAnswered } from '#/entities/session';
import { useAuditPage } from '#/pages/audit/use-cases/useAuditPage';
import { AUDIT, auditEvent } from '#/testing/auditFixtures';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const address = vi.hoisted(() => ({ search: '', go: vi.fn<(params: URLSearchParams) => void>() }));

vi.mock('#/shared/repository/useUrlSearch', () => ({
  useUrlSearch: () => ({
    params: new URLSearchParams(address.search),
    go: address.go,
    drop: vi.fn(),
  }),
}));

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T09:30:20Z'));
});

afterEach(() => {
  vi.useRealTimers();
  address.search = '';
  address.go.mockClear();
});

function page(capabilities: readonly string[] = ['view-audit', 'view-users']) {
  const harness = hookHarness({
    [`GET ${ACME_ADMIN}/whoami`]: whoami(capabilities),
    [`GET ${AUDIT}`]: json({ items: [auditEvent()] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return renderHook(() => ({ ...useAuditPage('acme'), answered: useAuthorityAnswered('acme') }), {
    wrapper,
  });
}

function appliedSearch(): URLSearchParams | undefined {
  return address.go.mock.calls.at(-1)?.[0];
}

it('holds a resource id typed with no resource type: the form cannot take it', async () => {
  const { result } = page();
  await waitFor(() => {
    expect(result.current.list.status).toBe('ready');
  });
  act(() => {
    result.current.form.set('resource_id', 'c1');
  });
  expect(result.current.form.draft.resource_id).toBe('');
  act(() => {
    result.current.form.submit();
  });
  expect(appliedSearch()?.has('resource_id')).toBe(false);
  act(() => {
    result.current.form.set('resource_type', 'client');
  });
  act(() => {
    result.current.form.set('resource_id', 'c1');
  });
  act(() => {
    result.current.form.submit();
  });
  expect(appliedSearch()?.get('resource_id')).toBe('c1');
  expect(appliedSearch()?.get('resource_type')).toBe('client');
});

it('blocks Apply while a date is typed that reads as nothing, and lifts it when it reads', async () => {
  const { result } = page();
  await waitFor(() => {
    expect(result.current.list.status).toBe('ready');
  });
  act(() => {
    result.current.form.report('from', 'That day does not exist.');
  });
  expect(result.current.form.blocked).toMatch(/not narrowed by it/u);
  expect(result.current.form.problems).toEqual({});
  act(() => {
    result.current.form.submit();
  });
  expect(address.go).not.toHaveBeenCalled();
  expect(result.current.form.problems.from).toBe('That day does not exist.');
  act(() => {
    result.current.form.report('from', null);
  });
  expect(result.current.form.blocked).toBeNull();
  act(() => {
    result.current.form.submit();
  });
  expect(address.go).toHaveBeenCalledTimes(1);
});

it('adds the day up to now to the filters held, a day and a minute apart at the edges', async () => {
  address.search = 'action=client.update';
  const { result } = page();
  await waitFor(() => {
    expect(result.current.list.status).toBe('ready');
  });
  act(() => {
    result.current.tooBroad.searchLastDay();
  });
  const search = appliedSearch();
  expect(search?.get('action')).toBe('client.update');
  expect(search?.get('from')).toBe('2026-10-11T09:30:00.000Z');
  expect(search?.get('to')).toBe('2026-10-12T09:30:59.999Z');
});

it('links an actor only for a tenant caller, and only while view-users is held', async () => {
  const tenant = auditEvent({ actor_origin: 'tenant', actor_subject_id: 'u1' });
  const system = auditEvent({ actor_origin: 'system', actor_subject_id: 'u1' });
  const held = page(['view-audit', 'view-users']);
  await waitFor(() => {
    expect(held.result.current.answered).toBe(true);
  });
  expect(held.result.current.hrefs.actor(tenant)).toBe('/console/acme/subjects/u1');
  expect(held.result.current.hrefs.actor(system)).toBeNull();
  const lacking = page(['view-audit']);
  await waitFor(() => {
    expect(lacking.result.current.answered).toBe(true);
  });
  expect(lacking.result.current.hrefs.actor(tenant)).toBeNull();
});

it('supplies the titles the page shows: the area name, the table name and the empty trail', async () => {
  const { result } = page();
  await waitFor(() => {
    expect(result.current.list.status).toBe('ready');
  });
  expect(result.current.title).toBe('Audit trail');
  expect(result.current.trailLabel).toBe('Audit events');
  expect(result.current.nothingYetTitle).toBe('No audit events yet');
});
