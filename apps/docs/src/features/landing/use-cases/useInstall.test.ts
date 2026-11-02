import { describe, expect, it } from 'vitest';
import { useInstall } from '@site/src/features/landing/use-cases/useInstall';
import { resultOf } from '@site/tests/support/hook';

describe('useInstall', () => {
  it('starts on the first shell with nothing copied, typed or interactive', () => {
    const install = resultOf(useInstall);
    expect(install).toMatchObject({
      shell: 'unix',
      status: 'idle',
      typing: 'off',
      typed: 0,
      lines: 0,
      interactive: false,
    });
    expect(typeof install.choose).toBe('function');
    expect(typeof install.copy).toBe('function');
  });
});
