import type { ThemeView } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { baseBody, templateRequest, templateValues } from '#/features/branding/services/values';
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

  it('reads a theme back into the same template values it was made from', () => {
    expect(Object.keys(templateValues(drafted))).toHaveLength(17);
  });
});
