import { describe, expect, it } from 'vitest';
import {
  STYLESHEET_HOOK_NAME_MAX,
  STYLESHEET_HOOKS_LIST_MAX,
  stylesheetHooksResponseSchema,
} from '#/admin/theme';

const LISTS = [
  'classes',
  'page_kind_classes',
  'elements',
  'pseudo_classes',
  'pseudo_elements',
  'tokens',
] as const;

function answer(list: (typeof LISTS)[number], names: string[]) {
  return {
    version: 1,
    classes: [],
    page_kind_classes: [],
    elements: [],
    pseudo_classes: [],
    pseudo_elements: [],
    tokens: [],
    [list]: names,
  };
}

describe('stylesheetHooksResponseSchema', () => {
  it.each(LISTS)('bounds the %s list and the length of a name in it', (list) => {
    const full = Array.from({ length: STYLESHEET_HOOKS_LIST_MAX }, (_, n) => `n${String(n)}`);
    const parses = (names: string[]) =>
      stylesheetHooksResponseSchema.safeParse(answer(list, names)).success;
    expect(parses(full)).toBe(true);
    expect(parses([...full, 'one-more'])).toBe(false);
    expect(parses(['a'.repeat(STYLESHEET_HOOK_NAME_MAX + 1)])).toBe(false);
  });
});
