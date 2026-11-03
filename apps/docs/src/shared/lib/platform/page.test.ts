import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  absent,
  canRevealOnScroll,
  isAutomated,
  subscribeNever,
  watchPageShown,
} from '@site/src/shared/platform/page';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('watching whether the page is shown', () => {
  it('reports the page as shown unless the tab is hidden, and stops', () => {
    const listeners = new Map<string, () => void>();
    const documentStub = {
      hidden: false,
      addEventListener: (name: string, run: () => void) => listeners.set(name, run),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    vi.stubGlobal('document', documentStub);
    const seen: boolean[] = [];
    const stop = watchPageShown((shown) => seen.push(shown));
    documentStub.hidden = true;
    listeners.get('visibilitychange')?.();
    documentStub.hidden = false;
    listeners.get('visibilitychange')?.();
    expect(seen).toEqual([false, true]);
    stop();
    expect(listeners.size).toBe(0);
  });
});

describe('what the page can say about the browser', () => {
  it('says whether automation is driving', () => {
    vi.stubGlobal('navigator', { webdriver: true });
    expect(isAutomated()).toBe(true);
    vi.stubGlobal('navigator', { webdriver: false });
    expect(isAutomated()).toBe(false);
  });

  it('reveals on scroll only with an observer and no automation', () => {
    vi.stubGlobal('IntersectionObserver', vi.fn());
    vi.stubGlobal('navigator', { webdriver: false });
    expect(canRevealOnScroll()).toBe(true);
    vi.stubGlobal('navigator', { webdriver: true });
    expect(canRevealOnScroll()).toBe(false);
    vi.stubGlobal('navigator', { webdriver: false });
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(canRevealOnScroll()).toBe(false);
  });

  it('has a subscription that never fires and an answer for the server that is no', () => {
    const stop = subscribeNever();
    stop();
    expect(absent()).toBe(false);
  });
});
