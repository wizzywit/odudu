import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPIED_FOR_MS } from '@site/src/features/landing/services/copyStatus';
import { commandOf } from '@site/src/features/landing/services/installTyping';
import { useInstall } from '@site/src/features/landing/use-cases/useInstall';
import { mount } from '@site/tests/support/hookRunner';

vi.mock('react', async () => (await import('@site/tests/support/hookRunner')).fakeReact);

const copyText = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());
vi.mock('@site/src/shared/platform/clipboard', () => ({ copyText }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  copyText.mockReset();
});

describe('useInstall copying', () => {
  it('copies the shell command, says it worked, and goes back to idle', async () => {
    copyText.mockResolvedValue(true);
    const hook = mount(useInstall);
    expect(hook.current().status).toBe('idle');
    hook.current().copy();
    await vi.advanceTimersByTimeAsync(0);
    expect(copyText).toHaveBeenCalledWith(commandOf('unix'));
    expect(hook.current().status).toBe('copied');
    await vi.advanceTimersByTimeAsync(COPIED_FOR_MS - 1);
    expect(hook.current().status).toBe('copied');
    await vi.advanceTimersByTimeAsync(1);
    expect(hook.current().status).toBe('idle');
  });

  it('says when the browser would not copy, and goes back to idle', async () => {
    copyText.mockResolvedValue(false);
    const hook = mount(useInstall);
    hook.current().copy();
    await vi.advanceTimersByTimeAsync(0);
    expect(hook.current().status).toBe('failed');
    await vi.advanceTimersByTimeAsync(COPIED_FOR_MS);
    expect(hook.current().status).toBe('idle');
  });

  it('takes another shell, which clears what the last copy said, and copies that one', async () => {
    copyText.mockResolvedValue(true);
    const hook = mount(useInstall);
    hook.current().copy();
    await vi.advanceTimersByTimeAsync(0);
    hook.current().choose('windows');
    expect(hook.current().shell).toBe('windows');
    expect(hook.current().status).toBe('idle');
    hook.current().copy();
    await vi.advanceTimersByTimeAsync(0);
    expect(copyText).toHaveBeenLastCalledWith(commandOf('windows'));
  });

  it('types over the command once the page is idle, and stops when the page goes', async () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('requestIdleCallback', undefined);
    const hook = mount(useInstall);
    expect(hook.current().typing).toBe('off');
    await vi.advanceTimersByTimeAsync(400);
    await vi.dynamicImportSettled();
    expect(hook.current().typing).toBe('on');
    await vi.advanceTimersByTimeAsync(500);
    const typed = hook.current().typed;
    expect(typed).toBeGreaterThan(0);
    hook.unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(hook.current().typed).toBe(typed);
  });

  it('shows the command as text from the first paint when reduced motion is asked for', () => {
    const hook = mount(useInstall);
    expect(hook.current().typing).toBe('skip');
    expect(vi.getTimerCount()).toBe(0);
  });
});
