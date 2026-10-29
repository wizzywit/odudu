import { stylesheetHooksResponseSchema } from '@odudu/contracts/admin';
import {
  CSS_ELEMENTS,
  CSS_HOOKS,
  CSS_HOOKS_VERSION,
  CSS_PSEUDO_CLASSES,
  CSS_PSEUDO_ELEMENTS,
  CSS_TOKENS,
  RENDERED_HOOKS,
} from '@odudu/domain-theme';
import { describe, expect, it } from 'vitest';
import { stylesheetHooks } from '#/service/stylesheet-hooks';

describe('the stylesheet hooks answer', () => {
  const answer = stylesheetHooks();

  it('is what the stylesheet checker accepts, list for list', () => {
    expect(answer.version).toBe(CSS_HOOKS_VERSION);
    expect(answer.classes).toEqual(RENDERED_HOOKS);
    expect([...answer.classes, ...answer.page_kind_classes]).toEqual(CSS_HOOKS);
    expect(answer.elements).toEqual(CSS_ELEMENTS);
    expect(answer.pseudo_classes).toEqual(CSS_PSEUDO_CLASSES);
    expect(answer.pseudo_elements).toEqual(CSS_PSEUDO_ELEMENTS);
    expect(answer.tokens).toEqual(CSS_TOKENS);
  });

  it('names every page kind once, as page- and the kind', () => {
    expect(answer.page_kind_classes.length).toBeGreaterThan(0);
    for (const name of answer.page_kind_classes) expect(name).toMatch(/^page-[a-z-]+$/u);
    expect(new Set(answer.page_kind_classes).size).toBe(answer.page_kind_classes.length);
  });

  it('matches its contract and is built once', () => {
    expect(stylesheetHooksResponseSchema.parse(answer)).toEqual(answer);
    expect(stylesheetHooks()).toBe(answer);
  });

  it('is small enough to send whole', () => {
    expect(JSON.stringify(answer).length).toBeLessThan(4000);
  });
});
