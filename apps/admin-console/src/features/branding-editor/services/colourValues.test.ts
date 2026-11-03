import type { ThemeView } from '#/features/branding-editor/types/theme';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES } from '#/features/branding-editor/services/palette';
import { colourRequest, colourValues } from '#/features/branding-editor/services/colourValues';
import { draftedView, EMPTY } from '#/testing/brandingFixtures';

describe('the colours in a request', () => {
  const drafted = draftedView() as ThemeView;

  it('replaces its own part and carries the rest of the draft, stylesheet included', () => {
    const withSheet = {
      ...drafted,
      draft: {
        ...EMPTY,
        stylesheet: 'a{}',
        templates: { notice: '{{message}}' },
        assets: { favicon: { assetId: 'f' } },
      },
    } as ThemeView;
    const request = colourRequest(withSheet, {
      ...colourValues(withSheet),
      'tokens.dark': DEFAULT_PALETTES.dark,
    });
    expect(request.stylesheet).toBe('a{}');
    expect(request.templates).toEqual({ notice: '{{message}}' });
    expect(request.assets).toEqual({ favicon: { assetId: 'f' } });
    expect(request.tokens).toEqual({ dark: DEFAULT_PALETTES.dark });
  });

  it('leaves a colour out when it is null, so the layer below supplies it', () => {
    const request = colourRequest(drafted, {
      'tokens.light': null,
      'tokens.dark': null,
      'tokens.font': null,
    });
    expect(request.tokens).toEqual({});
  });

  it('read a theme back into the same values they were made from', () => {
    expect(colourValues(drafted)['tokens.light']).not.toBeNull();
    expect(colourValues(drafted)['tokens.font']).toBeNull();
  });
});
