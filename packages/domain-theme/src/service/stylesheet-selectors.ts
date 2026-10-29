import { CSS_ELEMENTS, CSS_HOOKS, CSS_PSEUDO_CLASSES, CSS_PSEUDO_ELEMENTS } from '#/service/hooks';
import type { Problem } from '#/service/stylesheet-types';

const set = (words: string): ReadonlySet<string> => new Set(words.split(' '));

const HOOKS: ReadonlySet<string> = new Set(CSS_HOOKS);
const ELEMENTS: ReadonlySet<string> = new Set(CSS_ELEMENTS);
const PSEUDO_CLASSES: ReadonlySet<string> = new Set(CSS_PSEUDO_CLASSES);
const PSEUDO_ELEMENTS: ReadonlySet<string> = new Set(CSS_PSEUDO_ELEMENTS);

// This reasons about the markup the renderers emit: a control sits in a form,
// a label, main (.page), a p (the passkey button), or is a button itself, and
// .rules wraps one. The decorative hooks may be hidden (heading, tenant name,
// links, the mark, wordmark and logo images); a tenant's own template may
// wrap a part in an allowed element and hide that, which is accepted.
const CONTROL_ELEMENTS = set('button input form label main div section');
const HIDEABLE_ELEMENTS = set('img small span code h1 h2 h3 ul ol li a header footer');
const HIDEABLE_HOOKS = set(
  'brand context intro links logo logo-dark logo-light mark tenant wordmark',
);

export interface Compound {
  element: string | null;
  classes: string[];
}

const CSS_SPACE = '[ \\t\\r\\n\\f]';
const ELEMENT = /[A-Za-z][A-Za-z0-9]*/y;
const CLASS = /\.([A-Za-z_][A-Za-z0-9_-]*)/y;
const PSEUDO = /(::?)([A-Za-z][A-Za-z-]*)/y;
const COMBINATOR = new RegExp(`${CSS_SPACE}*([>+~])${CSS_SPACE}*|${CSS_SPACE}+`, 'y');
const TRIM = new RegExp(`^${CSS_SPACE}+|${CSS_SPACE}+$`, 'g');

function match(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

// One compound selector at `from`. Returns where it ended, or a problem.
function readCompound(
  text: string,
  from: number,
): { end: number; compound: Compound; last: boolean } | Problem {
  let at = from;
  let element: string | null = null;
  let any = false;
  let last = false;
  const classes: string[] = [];
  const head = match(ELEMENT, text, at);
  if (head !== null) {
    element = head[0].toLowerCase();
    if (!ELEMENTS.has(element)) return { code: 'selector-not-allowed', detail: head[0] };
    at += head[0].length;
    any = true;
  }
  for (;;) {
    if (last && at < text.length && text[at] !== ' ') {
      return { code: 'selector-not-allowed', detail: 'nothing may follow a pseudo-element' };
    }
    const found = text[at] === '.' ? match(CLASS, text, at) : null;
    if (found !== null) {
      const name = found[1] ?? '';
      if (!HOOKS.has(name)) return { code: 'unknown-class', detail: name };
      classes.push(name);
      at += found[0].length;
      any = true;
      continue;
    }
    const pseudo = text[at] === ':' ? match(PSEUDO, text, at) : null;
    if (pseudo === null) break;
    const name = (pseudo[2] ?? '').toLowerCase();
    if (pseudo[1] === '::') {
      if (!PSEUDO_ELEMENTS.has(name)) return { code: 'selector-not-allowed', detail: pseudo[0] };
      last = true;
    } else if (!PSEUDO_CLASSES.has(name)) {
      return { code: 'selector-not-allowed', detail: pseudo[0] };
    }
    at += pseudo[0].length;
    any = true;
  }
  if (!any) {
    return { code: 'selector-not-allowed', detail: `unexpected ${JSON.stringify(text[at] ?? '')}` };
  }
  return { end: at, compound: { element, classes }, last };
}

// A complex selector made only of hooks and listed element types. Written as
// anchored, sticky scans so the work is linear in a bounded input.
export function readSelector(raw: string): Compound[] | Problem {
  if (/[^ -~\t\n\r\f]|\\/.test(raw)) {
    return { code: 'selector-not-allowed', detail: 'an escape or a non-ASCII character' };
  }
  const text = raw.replace(TRIM, '');
  const compounds: Compound[] = [];
  let at = 0;
  for (;;) {
    const read = readCompound(text, at);
    if (!('compound' in read)) return read;
    compounds.push(read.compound);
    at = read.end;
    if (at >= text.length) return compounds;
    if (read.last)
      return { code: 'selector-not-allowed', detail: 'a pseudo-element ends a selector' };
    const joint = match(COMBINATOR, text, at);
    if (joint === null) {
      return { code: 'selector-not-allowed', detail: `unexpected ${JSON.stringify(text[at])}` };
    }
    at += joint[0].length;
    if (at >= text.length) return { code: 'selector-not-allowed', detail: 'trailing combinator' };
  }
}

export function mayBeHidden(selectors: Compound[][]): boolean {
  return selectors.every((compounds) => {
    const subject = compounds[compounds.length - 1];
    if (subject === undefined) return false;
    const named = subject.classes.length > 0;
    const subjectOk = named
      ? subject.classes.every((name) => HIDEABLE_HOOKS.has(name))
      : subject.element !== null && HIDEABLE_ELEMENTS.has(subject.element);
    return (
      subjectOk && compounds.every((c) => c.element === null || !CONTROL_ELEMENTS.has(c.element))
    );
  });
}
