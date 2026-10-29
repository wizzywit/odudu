import type { StylesheetHooksResponse } from '@odudu/contracts/admin';
import { KEY_LIST_LIMIT } from '#/features/branding/service/catalogue';
import { PAGE_KIND_LABELS, pageKindOf } from '#/features/branding/service/templates';

export interface SelectorOption {
  id: string;
  label: string;
  detail: string;
}

// The most selectors the list draws at once; typing narrows it.
export const SELECTOR_LIST_LIMIT = KEY_LIST_LIMIT;

export const SELECTORS_LABEL = 'Selectors you can use';

export const SELECTORS_NOTE = `Puts the selector you choose where the caret is in the stylesheet. The list shows at most ${String(SELECTOR_LIST_LIMIT)} entries: type part of a name or of what it is to narrow it.`;

export const SELECTORS_LOADING = 'Loading the list of selectors.';

export const SELECTORS_FAILED = 'The list of selectors could not be loaded.';

// What each kind of entry in the list is.
export const SELECTOR_GROUPS = {
  classes: 'Page class',
  pageKinds: 'Page-kind class',
  elements: 'Element',
  pseudoClasses: 'State, after a class or an element',
  pseudoElements: 'Part of an element, ends a selector',
  tokens: 'Design value, for a declaration',
} as const;

function pageKindDetail(name: string): string {
  const bare = name.replace(/^page-/u, '');
  const kind = pageKindOf(bare);
  return `${SELECTOR_GROUPS.pageKinds}: ${kind === undefined ? bare : PAGE_KIND_LABELS[kind]}`;
}

function entries(
  names: readonly string[],
  text: (name: string) => string,
  detail: (name: string) => string,
): SelectorOption[] {
  return names.map((name) => ({ id: text(name), label: text(name), detail: detail(name) }));
}

// The server's lists as the entries a rule can be written from, group by
// group in the server's order, each said to be what it is.
export function selectorOptions(hooks: StylesheetHooksResponse): SelectorOption[] {
  return [
    ...entries(
      hooks.classes,
      (name) => `.${name}`,
      () => SELECTOR_GROUPS.classes,
    ),
    ...entries(hooks.page_kind_classes, (name) => `.${name}`, pageKindDetail),
    ...entries(
      hooks.elements,
      (name) => name,
      () => SELECTOR_GROUPS.elements,
    ),
    ...entries(
      hooks.pseudo_classes,
      (name) => `:${name}`,
      () => SELECTOR_GROUPS.pseudoClasses,
    ),
    ...entries(
      hooks.pseudo_elements,
      (name) => `::${name}`,
      () => SELECTOR_GROUPS.pseudoElements,
    ),
    ...entries(
      hooks.tokens,
      (name) => `var(${name})`,
      () => SELECTOR_GROUPS.tokens,
    ),
  ];
}
