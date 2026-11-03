import { describe, expect, it } from 'vitest';
import { homeMapSections } from '@site/src/features/docs-home/services/homeMap';
import { introOf } from '@site/src/features/docs-home/services/intro';
import { useDocsHome } from '@site/src/features/docs-home/use-cases/useDocsHome';
import { resultOf } from '@site/tests/support/hook';

describe('useDocsHome', () => {
  it('hands the home its intro for the audience and the sections of its map', () => {
    expect(resultOf(() => useDocsHome('installation'))).toEqual({
      intro: introOf('installation'),
      sections: homeMapSections(),
    });
    expect(resultOf(() => useDocsHome('public')).intro).toBe(introOf('public'));
  });
});
