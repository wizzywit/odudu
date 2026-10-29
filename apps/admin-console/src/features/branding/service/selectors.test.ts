import type { StylesheetHooksResponse } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  SELECTOR_GROUPS,
  SELECTORS_LABEL,
  selectorOptions,
  STYLESHEET_REFUSALS,
} from '#/features/branding/service';

const HOOKS: StylesheetHooksResponse = {
  version: 1,
  classes: ['logo', 'page'],
  page_kind_classes: ['page-sign-in', 'page-future-kind'],
  elements: ['main', 'a'],
  pseudo_classes: ['hover'],
  pseudo_elements: ['before'],
  tokens: ['--ink-primary'],
};

describe('selectorOptions', () => {
  it('offers each name as the text a rule writes, in the server’s order, group by group', () => {
    expect(selectorOptions(HOOKS).map((option) => option.id)).toEqual([
      '.logo',
      '.page',
      '.page-sign-in',
      '.page-future-kind',
      'main',
      'a',
      ':hover',
      '::before',
      'var(--ink-primary)',
    ]);
  });

  it('says what each group is, and which page a page-kind class styles', () => {
    const details = new Map(selectorOptions(HOOKS).map((option) => [option.id, option.detail]));
    expect(details.get('.logo')).toBe(SELECTOR_GROUPS.classes);
    expect(details.get('.page-sign-in')).toBe(`${SELECTOR_GROUPS.pageKinds}: Sign in`);
    expect(details.get('main')).toBe(SELECTOR_GROUPS.elements);
    expect(details.get(':hover')).toBe(SELECTOR_GROUPS.pseudoClasses);
    expect(details.get('::before')).toBe(SELECTOR_GROUPS.pseudoElements);
    expect(details.get('var(--ink-primary)')).toBe(SELECTOR_GROUPS.tokens);
  });

  it('names a page kind it has no label for by the class itself, so a new kind still shows', () => {
    const option = selectorOptions(HOOKS).find((entry) => entry.id === '.page-future-kind');
    expect(option?.detail).toBe(`${SELECTOR_GROUPS.pageKinds}: future-kind`);
  });

  it('can be narrowed by a group’s words as well as by a name', () => {
    const everything = selectorOptions(HOOKS)
      .map((option) => `${option.label} ${option.detail}`)
      .join('\n');
    expect(everything).toContain('Element');
    expect(everything).toContain('Sign in');
  });

  it('is empty for an answer that lists nothing', () => {
    expect(
      selectorOptions({
        version: 1,
        classes: [],
        page_kind_classes: [],
        elements: [],
        pseudo_classes: [],
        pseudo_elements: [],
        tokens: [],
      }),
    ).toEqual([]);
  });
});

describe('the refusal for a selector outside the list', () => {
  it('says where the list is, for a selector and for a class', () => {
    expect(STYLESHEET_REFUSALS['selector-not-allowed']).toContain(`“${SELECTORS_LABEL}”`);
    expect(STYLESHEET_REFUSALS['unknown-class']).toContain(`“${SELECTORS_LABEL}”`);
  });
});
