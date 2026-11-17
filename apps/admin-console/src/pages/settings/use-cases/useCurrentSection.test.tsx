import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NavGroup } from '#/pages/settings/services/sectionPlan';
import { useCurrentSection } from '#/pages/settings/use-cases/useCurrentSection';

const GROUPS: readonly NavGroup[] = [
  {
    title: 'Tenant',
    items: [
      { id: 'general', headingId: 'h-general', title: 'General', dirty: false },
      { id: 'terms', headingId: 'h-terms', title: 'Terms', dirty: false },
    ],
  },
];

type Notify = (entries: { target: Element; isIntersecting: boolean }[]) => void;
const seen: { notify: Notify; disconnect: ReturnType<typeof vi.fn> }[] = [];

class FakeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  constructor(notify: Notify) {
    seen.push({ notify, disconnect: this.disconnect });
  }
}

const SECTIONS = new Map([
  ['h-general', document.createElement('section')],
  ['h-terms', document.createElement('section')],
]);
const sectionOf = (headingId: string): Element | null => SECTIONS.get(headingId) ?? null;

beforeEach(() => {
  seen.length = 0;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('is none until a section reaches the band, then the first one in page order', () => {
  const { result } = renderHook(() => useCurrentSection(GROUPS, sectionOf, true));
  expect(result.current).toBeNull();
  act(() => {
    seen[0]?.notify([
      { target: SECTIONS.get('h-terms') as Element, isIntersecting: true },
      { target: SECTIONS.get('h-general') as Element, isIntersecting: true },
    ]);
  });
  expect(result.current).toBe('general');
});

it('stays on the last section while none is in the band', () => {
  const { result } = renderHook(() => useCurrentSection(GROUPS, sectionOf, true));
  act(() => {
    seen[0]?.notify([{ target: SECTIONS.get('h-terms') as Element, isIntersecting: true }]);
  });
  act(() => {
    seen[0]?.notify([{ target: SECTIONS.get('h-terms') as Element, isIntersecting: false }]);
  });
  expect(result.current).toBe('terms');
});

it('stops watching when it goes away', () => {
  const { unmount } = renderHook(() => useCurrentSection(GROUPS, sectionOf, true));
  unmount();
  expect(seen[0]?.disconnect).toHaveBeenCalled();
});

it('does nothing where the browser has no observer', () => {
  vi.unstubAllGlobals();
  vi.stubGlobal('IntersectionObserver', undefined);
  const { result } = renderHook(() => useCurrentSection(GROUPS, sectionOf, true));
  expect(result.current).toBeNull();
});
