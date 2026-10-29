import { PAGE_KINDS } from '@odudu/kernel';

// Bumped whenever a hook is renamed or removed; adding one is not a break.
export const CSS_HOOKS_VERSION = 1;

// The classes the server pages render, which a tenant stylesheet may target,
// and `page-` plus the page kind for themed pages. `.logo { display: none }`
// hides the logo in either scheme; `.logo-light` and `.logo-dark` hide one
// variant. Not promised: a tenant can still draw over the page with allowed
// means (a huge box-shadow, large margins) or shrink a control (width or
// height 0, a transparent colour). None of it can run script, load an
// external resource or read a value. The stylesheet is served only as a
// standalone .css file and must never be inlined into a page.
export const RENDERED_HOOKS: readonly string[] = [
  'alert',
  'brand',
  'choice',
  'context',
  'hint',
  'intro',
  'links',
  'logo',
  'logo-dark',
  'logo-light',
  'mark',
  'page',
  'quiet',
  'rules',
  'rules-head',
  'secondary',
  'tenant',
  'wordmark',
];

export const PAGE_KIND_HOOKS: readonly string[] = Object.keys(PAGE_KINDS).map(
  (kind) => `page-${kind}`,
);

export const CSS_HOOKS: readonly string[] = [...RENDERED_HOOKS, ...PAGE_KIND_HOOKS];

// The states and parts of an element a selector may name after one colon or two.
export const CSS_PSEUDO_CLASSES: readonly string[] = [
  'hover',
  'focus',
  'focus-visible',
  'active',
  'disabled',
  'checked',
  'first-child',
  'last-child',
];

export const CSS_PSEUDO_ELEMENTS: readonly string[] = ['before', 'after', 'placeholder'];

export const CSS_ELEMENTS: readonly string[] = [
  'main',
  'h1',
  'h2',
  'h3',
  'p',
  'a',
  'ul',
  'ol',
  'li',
  'label',
  'input',
  'button',
  'small',
  'code',
  'img',
  'span',
  'div',
  'section',
  'header',
  'footer',
  'form',
];

// The Instrument design tokens a tenant stylesheet may read with var().
export const CSS_TOKENS: readonly string[] = [
  '--border-strong',
  '--control-height',
  '--ease',
  '--focus-ring',
  '--font-mono',
  '--font-sans',
  '--hairline',
  '--ink-muted',
  '--ink-primary',
  '--label-line',
  '--motion-fast',
  '--radius-m',
  '--radius-s',
  '--shadow-overlay',
  '--signal-active',
  '--signal-active-ink',
  '--signal-danger',
  '--signal-danger-ink',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-6',
  '--space-8',
  '--surface-grid',
  '--surface-page',
  '--surface-panel',
  '--surface-sunken',
  '--target-min',
  '--type-12',
  '--type-13',
  '--type-15',
  '--type-20',
];
