import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Platform } from '#/shared/service/platform.ts';
import css from '#/shared/view/KeyHint.module.css?raw';
import { KeyHint, PlatformContext } from '#/shared/view/KeyHint.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function on(platform: Platform, hint: React.ReactElement) {
  return <PlatformContext value={platform}>{hint}</PlatformContext>;
}

describe.each([
  ['mac', 'or press ↩ Return', 'or press Return'],
  ['other', 'or press ↵ Enter', 'or press Enter'],
] as const)('on %s', (platform, shown, spoken) => {
  it('reads as a sentence where no control announces the shortcut', () => {
    render(
      on(
        platform,
        <>
          <button type="button" aria-describedby="hint">
            Save
          </button>
          <KeyHint id="hint" lead="or press" keys={['Enter']} />
        </>,
      ),
    );
    const hint = document.getElementById('hint');
    expect(hint?.textContent).toBe(shown);
    expect(hint).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription(spoken);
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => on(platform, <KeyHint lead="or press" keys={['Enter']} />)),
    ).toEqual({ light: [], dark: [] });
  });
});

it('is hidden where the control already carries aria-keyshortcuts', () => {
  const { container } = render(on('mac', <KeyHint lead="or press" keys={['[']} announced />));
  expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  expect(container.firstElementChild).toHaveTextContent('or press [');
});

it('joins a chord, each key named for the platform', () => {
  const { container } = render(on('other', <KeyHint lead="Press" keys={['Mod', 'Alt', 'k']} />));
  expect(container.firstElementChild?.textContent).toBe('Press Ctrl+Alt+k');
  const mac = render(on('mac', <KeyHint lead="Press" keys={['Mod', 'k']} />));
  expect(mac.container.firstElementChild?.textContent).toBe('Press ⌘Command+k');
  expect(mac.container.querySelector('[aria-hidden="true"]')).toHaveTextContent('⌘');
});

it('reads as information, not as a control', () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  expect(source).not.toMatch(/border(?:-block-end)?(?:-width)?:\s*(?!0|none)/u);
  expect(source).not.toMatch(/background:/u);
  expect(source).toMatch(/color:\s*var\(--key-hint-ink,\s*var\(--ink-muted\)\)/u);
});

it('draws a chord that names one key twice, each in its place', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { container } = render(on('other', <KeyHint lead="Press" keys={['g', 'g']} />));
  expect(container.firstElementChild?.textContent).toBe('Press g+g');
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});
