import type { ThemeView } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  baseBody,
  colourRequest,
  colourValues,
  DEFAULT_PALETTES,
  imageRequest,
  imageValues,
  templateRequest,
  templateValues,
} from '#/features/branding/service';
import { draftedView, EMPTY, themeView } from '#/testing/brandingFixtures';

const view = (changes: Record<string, unknown> = {}) => themeView(changes) as ThemeView;

describe('what a save starts from', () => {
  it('is the draft, else the published theme, else nothing', () => {
    const published = {
      id: 'v',
      version: 1,
      published_at: null,
      body: { ...EMPTY, stylesheet: 'a{}' },
    };
    expect(baseBody(view())).toEqual(EMPTY);
    expect(baseBody(view({ published })).stylesheet).toBe('a{}');
    expect(baseBody(view({ published, draft: { ...EMPTY, stylesheet: 'b{}' } })).stylesheet).toBe(
      'b{}',
    );
  });
});

describe('a section’s request', () => {
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

  it('leaves a part out when it is null, so the layer below supplies it', () => {
    const request = colourRequest(drafted, {
      'tokens.light': null,
      'tokens.dark': null,
      'tokens.font': null,
    });
    expect(request.tokens).toEqual({});
    const images = imageRequest(drafted, {
      ...imageValues(drafted),
      'assets.logo': null,
    });
    expect(images.assets).toEqual({});
  });

  it('keeps only templates that hold something', () => {
    const values = {
      ...templateValues(drafted),
      'templates.sign-in': '<p>{{form.open}}</p>',
      'templates.notice': '   ',
    };
    expect(templateRequest(drafted, values).templates).toEqual({
      'sign-in': '<p>{{form.open}}</p>',
    });
  });

  it('reads a theme back into the same values it was made from', () => {
    expect(colourValues(drafted)['tokens.light']).not.toBeNull();
    expect(colourValues(drafted)['tokens.font']).toBeNull();
    expect(imageValues(drafted)['assets.logo']).toMatchObject({ alt: 'Acme' });
    expect(Object.keys(templateValues(drafted))).toHaveLength(17);
  });
});
