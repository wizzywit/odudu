import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSignInFlow } from '@site/src/features/landing/use-cases/useSignInFlow';
import { mount } from '@site/tests/support/hookRunner';

vi.mock('react', async () => (await import('@site/tests/support/hookRunner')).fakeReact);

const IDLE_FOR_MS = 60_000;

function stubBrowser(reduced: boolean): void {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal('IntersectionObserver', vi.fn());
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSignInFlow motion', () => {
  it('never starts for a reader who asked for less motion, and sets no clock', async () => {
    stubBrowser(true);
    const hook = mount(useSignInFlow);
    await vi.advanceTimersByTimeAsync(IDLE_FOR_MS);
    expect(hook.current()).toMatchObject({ step: 0, wantsPlay: false, view: { running: false } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('plays no step until the scene is in view, which needs an element to watch', async () => {
    stubBrowser(false);
    const hook = mount(useSignInFlow);
    await vi.advanceTimersByTimeAsync(IDLE_FOR_MS);
    expect(hook.current()).toMatchObject({ step: 0, view: { running: false } });
  });

  it('takes a step chosen by the reader', () => {
    stubBrowser(true);
    const hook = mount(useSignInFlow);
    hook.current().choose(3);
    expect(hook.current().step).toBe(3);
  });
});
