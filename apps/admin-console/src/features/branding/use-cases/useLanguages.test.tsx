import type { Settings } from '@odudu/contracts/admin';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { ADD_DUPLICATE, ADD_NEEDED } from '#/features/branding/services/addedLanguage';
import {
  ALREADY_REMOVED,
  REMOVED_TEXT,
  STALE_REMOVAL,
} from '#/features/branding/services/overrideRemoval';
import { useLanguagesSection, useOverrides } from '#/features/branding/use-cases/useLanguages';
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

function section() {
  const { wrapper } = signedIn({});
  return renderHook(
    () => useLanguagesSection({ tenant: 'acme', data: DATA, etag: '"s1"', gone: false }),
    { wrapper },
  );
}

it('adds a typed language to the supported ones and clears what was typed', () => {
  const { result } = section();
  act(() => {
    result.current.typeAdding('fr');
  });
  expect(result.current.adding).toBe('fr');
  act(() => {
    result.current.add();
  });
  expect(result.current.save.values.supported_locales).toEqual(['en', 'ar', 'fr']);
  expect(result.current.adding).toBe('');
  expect(result.current.addProblem).toBeUndefined();
});

it('says why a language cannot be added, and lets go of that when typing goes on', () => {
  const { result } = section();
  act(() => {
    result.current.add();
  });
  expect(result.current.addProblem).toBe(ADD_NEEDED);
  act(() => {
    result.current.typeAdding('AR');
  });
  expect(result.current.addProblem).toBeUndefined();
  act(() => {
    result.current.add();
  });
  expect(result.current.addProblem).toBe(ADD_DUPLICATE);
  expect(result.current.save.values.supported_locales).toEqual(['en', 'ar']);
});

function overrides(routes: Record<string, Answer>) {
  const { wrapper, sent } = signedIn({
    [`GET ${MO}`]: json({ items: [TITLE_OVERRIDE, HELP_OVERRIDE] }),
    ...routes,
  });
  const view = renderHook(() => useOverrides('acme', DATA), { wrapper });
  return { ...view, sent };
}

const REMOVED = { locale: 'en', key: 'login.title', etag: TITLE_OVERRIDE.etag };

it('opens on the first supported language and reads its overrides', async () => {
  const { result } = overrides({});
  expect(result.current.locale).toBe('en');
  await waitFor(() => {
    expect(result.current.list.rows).toHaveLength(2);
  });
});

it('removes an override after it is asked for, and says so', async () => {
  const { result, sent } = overrides({
    [`DELETE ${MO}/en/login.title`]: () => new Response(null, { status: 204 }),
  });
  await waitFor(() => {
    expect(result.current.list.rows).toHaveLength(2);
  });
  act(() => {
    result.current.ask(REMOVED);
  });
  expect(result.current.consequence).toMatch(/en show the catalogue’s text for login\.title/u);
  await act(async () => {
    await result.current.confirm();
  });
  expect(sent.find((request) => request.method === 'DELETE')).toMatchObject({
    ifMatch: TITLE_OVERRIDE.etag,
  });
  expect(result.current.removing).toBeNull();
  expect(result.current.notice).toBe(REMOVED_TEXT);
});

it('closes the dialog on an override that changed after it was seen, and says to look at the list', async () => {
  const { result } = overrides({
    [`DELETE ${MO}/en/login.title`]: problem(412, 'about:blank', 'Precondition Failed'),
  });
  await waitFor(() => {
    expect(result.current.list.rows).toHaveLength(2);
  });
  act(() => {
    result.current.ask(REMOVED);
  });
  await act(async () => {
    await result.current.confirm();
  });
  expect(result.current.removing).toBeNull();
  expect(result.current.notice).toBe(STALE_REMOVAL);
  expect(result.current.removeProblem).toBeNull();
  expect(result.current.removed).toBe(1);
});

it('counts an override that is already gone as removed', async () => {
  const { result } = overrides({
    [`DELETE ${MO}/en/login.title`]: problem(404, 'about:blank', 'Not Found'),
  });
  await waitFor(() => {
    expect(result.current.list.rows).toHaveLength(2);
  });
  act(() => {
    result.current.ask(REMOVED);
  });
  await act(async () => {
    await result.current.confirm();
  });
  expect(result.current.notice).toBe(ALREADY_REMOVED);
});
