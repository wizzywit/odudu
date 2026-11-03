import type { Settings } from '@odudu/contracts/admin';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import {
  ALREADY_REMOVED,
  REMOVED_TEXT,
  STALE_REMOVAL,
} from '#/pages/branding/services/overrideRemoval';
import { useOverrideTable } from '#/pages/branding/use-cases/useOverrideTable';
import { brandingRoutes, HELP_OVERRIDE, MO, TITLE_OVERRIDE } from '#/testing/brandingFixtures';
import { json, problem, type Answer } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';
import { SETTINGS } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const DATA = { ...SETTINGS, supported_locales: ['en', 'ar'] } as unknown as Settings;

function signedIn(routes: Record<string, Answer>) {
  const harness = hookHarness(brandingRoutes(undefined, routes));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return { wrapper, sent: harness.sent };
}

function overrides(routes: Record<string, Answer>) {
  const { wrapper, sent } = signedIn({
    [`GET ${MO}`]: json({ items: [TITLE_OVERRIDE, HELP_OVERRIDE] }),
    ...routes,
  });
  const view = renderHook(() => useOverrideTable('acme', DATA), { wrapper });
  return { ...view, sent };
}

const REMOVED = { locale: 'en', key: 'login.title', etag: TITLE_OVERRIDE.etag };

it('opens on the first supported language and reads its overrides', async () => {
  const { result } = overrides({});
  expect(result.current.locale.value).toBe('en');
  await waitFor(() => {
    expect(result.current.table.list.rows).toHaveLength(2);
  });
});

it('removes an override after it is asked for, and says so', async () => {
  const { result, sent } = overrides({
    [`DELETE ${MO}/en/login.title`]: () => new Response(null, { status: 204 }),
  });
  await waitFor(() => {
    expect(result.current.table.list.rows).toHaveLength(2);
  });
  act(() => {
    result.current.removal.ask(REMOVED);
  });
  expect(result.current.removal.consequence).toMatch(
    /en show the catalogue’s text for login\.title/u,
  );
  await act(async () => {
    await result.current.removal.confirm();
  });
  expect(sent.find((request) => request.method === 'DELETE')).toMatchObject({
    ifMatch: TITLE_OVERRIDE.etag,
  });
  expect(result.current.removal.removing).toBeNull();
  expect(result.current.removal.notice).toBe(REMOVED_TEXT);
});

it('closes the dialog on an override that changed after it was seen, and says to look at the list', async () => {
  const { result } = overrides({
    [`DELETE ${MO}/en/login.title`]: problem(412, 'about:blank', 'Precondition Failed'),
  });
  await waitFor(() => {
    expect(result.current.table.list.rows).toHaveLength(2);
  });
  act(() => {
    result.current.removal.ask(REMOVED);
  });
  await act(async () => {
    await result.current.removal.confirm();
  });
  expect(result.current.removal.removing).toBeNull();
  expect(result.current.removal.notice).toBe(STALE_REMOVAL);
  expect(result.current.removal.problem).toBeNull();
  expect(result.current.removal.count).toBe(1);
});

it('counts an override that is already gone as removed', async () => {
  const { result } = overrides({
    [`DELETE ${MO}/en/login.title`]: problem(404, 'about:blank', 'Not Found'),
  });
  await waitFor(() => {
    expect(result.current.table.list.rows).toHaveLength(2);
  });
  act(() => {
    result.current.removal.ask(REMOVED);
  });
  await act(async () => {
    await result.current.removal.confirm();
  });
  expect(result.current.removal.notice).toBe(ALREADY_REMOVED);
});
