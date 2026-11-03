import type { Settings } from '@odudu/contracts/admin';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { ADD_DUPLICATE, ADD_NEEDED } from '#/pages/branding/services/addedLanguage';
import { useLanguagesSection } from '#/pages/branding/use-cases/useLanguages';
import { brandingRoutes } from '#/testing/brandingFixtures';
import { type Answer } from '#/testing/fakeTransport';
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
    result.current.add.type('fr');
  });
  expect(result.current.add.value).toBe('fr');
  act(() => {
    result.current.add.press();
  });
  expect(result.current.save.values.supported_locales).toEqual(['en', 'ar', 'fr']);
  expect(result.current.add.value).toBe('');
  expect(result.current.add.problem).toBeUndefined();
});

it('says why a language cannot be added, and lets go of that when typing goes on', () => {
  const { result } = section();
  act(() => {
    result.current.add.press();
  });
  expect(result.current.add.problem).toBe(ADD_NEEDED);
  act(() => {
    result.current.add.type('AR');
  });
  expect(result.current.add.problem).toBeUndefined();
  act(() => {
    result.current.add.press();
  });
  expect(result.current.add.problem).toBe(ADD_DUPLICATE);
  expect(result.current.save.values.supported_locales).toEqual(['en', 'ar']);
});
