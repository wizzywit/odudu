export type {
  StylesheetIssue,
  StylesheetIssueCode,
  StylesheetOptions,
} from '#/service/stylesheet-types';
import {
  parse,
  type AtRule,
  type ChildNode,
  type Declaration,
  type Node,
  type Rule,
} from 'postcss';
import {
  isSurface,
  legibilityProblem,
  outlineProblem,
  outlineValueProblem,
  readColour,
  sameColour,
  type Scheme,
} from '#/service/stylesheet-legibility';
import { PROPERTIES } from '#/service/stylesheet-properties';
import {
  mayBeHidden,
  ownsBackground,
  readSelector,
  type Compound,
} from '#/service/stylesheet-selectors';
import type {
  StylesheetIssue,
  StylesheetIssueCode,
  StylesheetOptions,
} from '#/service/stylesheet-types';
import { checkValue } from '#/service/stylesheet-values';

export const MAX_STYLESHEET_BYTES = 128 * 1024;
export const MAX_RULES = 2000;
export const MAX_DECLARATIONS = 10_000;
export const MAX_SELECTORS = 10;
export const MAX_SELECTOR_LENGTH = 200;
export const MAX_VALUE_LENGTH = 4096;
const MAX_ISSUES = 100;
const MAX_PARAMS_LENGTH = 200;

const MAX_DETAIL = 60;

// Issue details echo tenant input; cut at a code point, not inside a pair.
function bound(detail: string): string {
  if (detail.length <= MAX_DETAIL) return detail;
  const high = detail.charCodeAt(MAX_DETAIL - 1);
  const low = detail.charCodeAt(MAX_DETAIL);
  const split = high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
  return detail.slice(0, split ? MAX_DETAIL - 1 : MAX_DETAIL);
}

type Add = (code: StylesheetIssueCode, detail: string, node?: Node) => void;

function mediaAllowed(params: string): boolean {
  const feature =
    '\\((?:prefers-color-scheme: ?(?:light|dark)|(?:min|max)-width: ?\\d+(?:\\.\\d+)?(?:px|em|rem)|prefers-reduced-motion: ?(?:reduce|no-preference))\\)';
  return new RegExp(`^${feature}(?: and ${feature})*$`).test(params.toLowerCase());
}

// Fail closed: a stylesheet is accepted only when the parser can read all of
// it and every at-rule, selector, property and value in it is recognised.
// The tree is walked one level at a time, never recursively, so nesting
// cannot cost more than the size cap allows.
export function checkStylesheet(css: string, options: StylesheetOptions = {}): StylesheetIssue[] {
  const issues: StylesheetIssue[] = [];
  let stopped = false;
  const add: Add = (code, detail, node) => {
    if (stopped) return;
    if (issues.length >= MAX_ISSUES - 1) {
      issues.push({
        code: 'too-many-issues',
        detail: `more than ${String(MAX_ISSUES - 1)}`,
        line: null,
        column: null,
      });
      stopped = true;
      return;
    }
    const start = node?.source?.start;
    issues.push({
      code,
      detail: bound(detail),
      line: start?.line ?? null,
      column: start?.column ?? null,
    });
  };

  if (css.length > MAX_STYLESHEET_BYTES) {
    add('too-large', `${String(css.length)}+ bytes`);
    return issues;
  }
  if (css.length * 3 > MAX_STYLESHEET_BYTES) {
    const bytes = new TextEncoder().encode(css).length;
    if (bytes > MAX_STYLESHEET_BYTES) {
      add('too-large', `${String(bytes)} bytes`);
      return issues;
    }
  }
  const nul = css.indexOf('\u0000');
  if (nul !== -1) {
    const before = css.slice(0, nul);
    const line = before.split('\n').length;
    const column = nul - (before.lastIndexOf('\n') + 1) + 1;
    issues.push({ code: 'nul-byte', detail: 'NUL byte', line, column });
    return issues;
  }

  let root;
  try {
    root = parse(css);
  } catch (error) {
    const at = error as { reason?: unknown; line?: unknown; column?: unknown };
    issues.push({
      code: 'unparsable',
      detail: bound(typeof at.reason === 'string' ? at.reason : 'unreadable'),
      line: typeof at.line === 'number' ? at.line : null,
      column: typeof at.column === 'number' ? at.column : null,
    });
    return issues;
  }

  let rules = 0;
  let declarations = 0;

  const checkDeclaration = (decl: Declaration, mayHide: boolean, scheme: Scheme): void => {
    declarations += 1;
    if (declarations > MAX_DECLARATIONS) {
      add('too-many-declarations', `more than ${String(MAX_DECLARATIONS)}`);
      stopped = true;
      return;
    }
    const property = decl.prop.toLowerCase();
    if (/\S/.test(decl.raws.before ?? '') || !PROPERTIES.has(property)) {
      add('property-not-allowed', decl.prop, decl);
      return;
    }
    // Refused everywhere rather than on layout properties only: nothing a
    // tenant needs depends on beating the server's own rules.
    if (decl.important) {
      add('value-not-allowed', '!important', decl);
      return;
    }
    if (decl.value.length > MAX_VALUE_LENGTH) {
      add('too-long', `${property} value longer than ${String(MAX_VALUE_LENGTH)} characters`, decl);
      return;
    }
    if (property === 'display' && decl.value.trim().toLowerCase() === 'none' && !mayHide) {
      add('value-not-allowed', 'display: none could hide the form', decl);
      return;
    }
    const outline =
      outlineProblem(property, decl.value) ?? outlineValueProblem(property, decl.value, scheme);
    const unreadable = mayHide ? null : legibilityProblem(property, decl.value);
    if (outline !== null || unreadable !== null) {
      add('value-not-allowed', `${property}: ${outline ?? unreadable ?? ''}`, decl);
      return;
    }
    checkValue(property, decl.value, options.isAssetUrl, (code, detail) => {
      add(code, `${property}: ${detail}`, decl);
    });
  };

  // What one rule does to a needed part as a whole: text the colour of what
  // is behind it. A ground of its own is an opaque colour that is neither the
  // text's nor one of the page's surfaces; anything else lends the page.
  const checkWhole = (rule: Rule, scheme: Scheme, ownsGround: boolean): void => {
    let text: Declaration | undefined;
    let ground: Declaration | undefined;
    for (const child of rule.nodes) {
      if (child.type !== 'decl') continue;
      const property = child.prop.toLowerCase();
      if (property === 'color') text = child;
      else if (property === 'background-color' || property === 'background') ground = child;
    }
    const a = text === undefined ? null : readColour(text.value);
    if (text === undefined || a === null) return;
    const b = ground === undefined ? null : readColour(ground.value);
    if (b !== null && sameColour(a, b)) {
      add('value-not-allowed', 'color: the same as the background', text);
      return;
    }
    const own = b?.key != null && !b.clear && !isSurface(b, scheme);
    if (!own && !ownsGround && isSurface(a, scheme)) {
      add('value-not-allowed', 'color: the same as the page behind it', text);
    }
  };

  const checkRule = (rule: Rule, scheme: Scheme): void => {
    rules += 1;
    if (rules > MAX_RULES) {
      add('too-many-rules', `more than ${String(MAX_RULES)}`);
      stopped = true;
      return;
    }
    const compounds: Compound[][] = [];
    const selector = rule.selector;
    if (selector.length > MAX_SELECTOR_LENGTH) {
      add('too-long', `selector longer than ${String(MAX_SELECTOR_LENGTH)} characters`, rule);
    } else {
      const list = selector.split(',');
      if (list.length > MAX_SELECTORS) {
        add('too-long', `more than ${String(MAX_SELECTORS)} selectors`, rule);
      } else {
        for (const one of list) {
          const read = readSelector(one);
          if ('code' in read) add(read.code, read.detail, rule);
          else compounds.push(read);
        }
      }
    }
    const mayHide = compounds.length > 0 && mayBeHidden(compounds);
    if (!mayHide) checkWhole(rule, scheme, ownsBackground(compounds));
    for (const child of rule.nodes) {
      if (stopped) return;
      if (child.type === 'decl') checkDeclaration(child, mayHide, scheme);
      else if (child.type === 'rule') add('selector-not-allowed', 'a nested rule', child);
      else if (child.type === 'atrule') {
        add('at-rule-not-allowed', `@${child.name} inside a rule`, child);
      }
    }
  };

  const checkAtRule = (rule: AtRule): void => {
    if (rule.name !== 'media') {
      add('at-rule-not-allowed', `@${rule.name}`, rule);
    } else if (rule.nodes === undefined) {
      add('at-rule-not-allowed', '@media without a block', rule);
    } else if (
      rule.params.length > MAX_PARAMS_LENGTH ||
      rule.raws.params !== undefined ||
      !mediaAllowed(rule.params)
    ) {
      add('media-query-not-allowed', rule.params, rule);
    } else {
      const scheme = /prefers-color-scheme: ?dark/.test(rule.params.toLowerCase()) ? 'dark' : 'any';
      for (const child of rule.nodes) visit(child, true, scheme);
    }
  };

  const visit = (node: ChildNode, inMedia: boolean, scheme: Scheme = 'any'): void => {
    if (stopped) return;
    if (node.type === 'decl') add('root-declaration', node.prop, node);
    else if (node.type === 'rule') checkRule(node, scheme);
    else if (node.type === 'atrule') {
      if (inMedia) add('at-rule-not-allowed', `@${node.name} inside @media`, node);
      else checkAtRule(node);
    }
  };

  for (const node of root.nodes) visit(node, false);
  return issues;
}
