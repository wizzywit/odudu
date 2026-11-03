import { describe, expect, it } from 'vitest';
import { noteFor } from '@site/src/features/landing/services/copyStatus';
import { useInstall } from '@site/src/features/landing/use-cases/useInstall';
import { resultOf } from '@site/tests/support/hook';

describe('useInstall', () => {
  it('starts on the first shell with nothing copied, typed or interactive', () => {
    const install = resultOf(useInstall);
    const { view } = install;
    expect(view.shells.find((entry) => entry.checked)?.shell).toBe('unix');
    expect(view.copyBar).toEqual({
      status: 'idle',
      label: 'Copy',
      note: noteFor('idle'),
      hidden: true,
    });
    expect(view.panels[0]?.typing).toBe('off');
    expect(view.panels[0]?.overlay).toBeNull();
    expect(view.panels[0]?.lines.some((line) => line.visible)).toBe(false);
    expect(typeof install.choose).toBe('function');
    expect(typeof install.copy).toBe('function');
  });
});
