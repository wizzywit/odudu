import type { ThemeView } from '#/features/branding-editor/types/theme';
import { describe, expect, it } from 'vitest';
import {
  templateRequest,
  templateValues,
} from '#/features/branding-editor/services/templateValues';
import { draftedView } from '#/testing/brandingFixtures';

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
