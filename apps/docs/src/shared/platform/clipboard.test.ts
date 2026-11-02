import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@site/src/shared/platform/clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('writes the text and resolves true', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('odudu init')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('odudu init');
  });

  it('resolves false when the write is refused', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('refused')) },
    });
    expect(await copyText('x')).toBe(false);
  });

  it('resolves false where there is no clipboard', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copyText('x')).toBe(false);
  });
});
