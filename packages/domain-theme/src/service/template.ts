import {
  MAX_TEMPLATE_LENGTH,
  PAGE_KINDS,
  scanSlots,
  type PageKind,
  type PageManifest,
} from '@odudu/kernel';
import { defaultTreeAdapter, html, parseFragment, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

// Slot and element bounds keep a save's work linear in a small input.
export const MAX_TEMPLATE_SLOTS = 200;
export const MAX_TEMPLATE_DEPTH = 32;
export const MAX_TEMPLATE_ELEMENTS = 2000;
const MAX_ISSUES = 100;

export type TemplateIssueCode =
  | 'too-large'
  | 'too-many-slots'
  | 'malformed-slot'
  | 'unknown-slot'
  | 'unknown-message-key'
  | 'missing-part'
  | 'repeated-part'
  | 'slot-in-attribute'
  | 'slot-in-raw-text'
  | 'comment'
  | 'element-not-allowed'
  | 'attribute-not-allowed'
  | 'href-not-https'
  | 'link-rel'
  | 'img-src'
  | 'img-alt'
  | 'unterminated'
  | 'unparsed-tag'
  | 'unclosed-element'
  | 'too-deep'
  | 'too-many-elements'
  | 'form-pair'
  | 'form-placement'
  | 'part-placement';

export interface TemplateIssue {
  code: TemplateIssueCode;
  detail: string;
  // 1-based position of the first thing the issue is about; null when it
  // has no single place (too large, a part that is missing).
  line: number | null;
  column: number | null;
}

type Add = (code: TemplateIssueCode, detail: string, offset?: number) => void;

export interface TemplateOptions {
  // Whether a URL names one of the theme's own uploaded assets. Without it
  // no <img src> is acceptable.
  isAssetUrl?: (url: string) => boolean;
  // Whether `{{t "key"}}` names an entry of the catalogue the page is filled
  // from. Without it any key is accepted, the way a stored theme is read back
  // at render, where an unknown key makes the template unfillable.
  isMessageKey?: (key: string) => boolean;
}

// Anything not listed is refused. Form controls, scripts, styles, embeds
// and foreign content are absent on purpose; the server emits every one of
// those itself, as parts.
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'li',
  'mark',
  'nav',
  'ol',
  'p',
  'q',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'wbr',
]);

// Elements whose content the parser reads as text. Tested by tag name in
// every namespace, because the parser leaves svg's own style, script and
// title as ordinary children rather than raw text.
const RAW_TEXT: ReadonlySet<string> = new Set([
  'title',
  'textarea',
  'style',
  'script',
  'noscript',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
]);

const ELEMENT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ['href', 'rel'],
  img: ['src', 'alt'],
};
const GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set(['class', 'lang', 'dir', 'role']);

const TAG_NAME = /<(\/?)([a-zA-Z][^\s/>]*)/g;
// Elements whose end tag may be missing from the source: the next block the
// server emits ends them, so they cannot wrap it. Any other element with no
// end tag in the source is refused, including one the parser closes by
// itself (`<div><span></div>`), which is stricter than "open at the end".
const OMISSIBLE_END: ReadonlySet<string> = new Set([
  'p',
  'li',
  'dd',
  'dt',
  'td',
  'th',
  'tr',
  'tbody',
  'thead',
  'tfoot',
  'caption',
  'br',
  'img',
  'hr',
  'wbr',
]);
// Where a browser moves what the server puts in a slot: text between table
// parts is lifted out in front of the table, a form opened there is closed at
// once, and a link inside a link ends the first.
const NOT_FOR_PARTS: ReadonlySet<string> = new Set(['a', 'table', 'tbody', 'thead', 'tfoot', 'tr']);
const VOID_ELEMENTS: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'wbr']);
const HAS_BRACES = /\{\{|\}\}/;

// Where the parser put a node against where the source has it: it lifts
// whatever sits between table parts out in front of the table, so a node's
// source position falls after a sibling that follows it in the tree. Text
// merged into an earlier node is placed by its end.
function firstLifted(children: Node[]): number | null {
  let latest = Infinity;
  let found: number | null = null;
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const location = children[i]?.sourceCodeLocation ?? null;
    if (location === null) continue;
    if (location.endOffset > latest) found = location.startOffset;
    latest = Math.min(latest, location.startOffset);
  }
  return found;
}

function isHttps(value: string): boolean {
  if (!/^https:/i.test(value) || /[\u0000- \u007f]/.test(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function relTokens(value: string | undefined): string[] {
  return (value ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function checkAttributes(element: Element, options: TemplateOptions, add: Add): void {
  const at = element.sourceCodeLocation?.startTag?.startOffset;
  const tag = element.tagName;
  const allowedHere = ELEMENT_ATTRIBUTES[tag] ?? [];
  const value = (name: string): string | undefined =>
    element.attrs.find((attr) => attr.name === name)?.value;
  for (const { name, value: attrValue } of element.attrs) {
    if (HAS_BRACES.test(name) || HAS_BRACES.test(attrValue)) {
      add('slot-in-attribute', `${tag} ${name}`, at);
    } else if (
      !GLOBAL_ATTRIBUTES.has(name) &&
      !/^aria-[a-z]+(?:-[a-z]+)*$/.test(name) &&
      !allowedHere.includes(name)
    ) {
      add('attribute-not-allowed', `${tag} ${name}`, at);
    }
  }
  if (tag === 'a') {
    const href = value('href');
    if (href === undefined || !isHttps(href)) add('href-not-https', 'a href', at);
    const rel = relTokens(value('rel'));
    if (!rel.includes('noopener') || !rel.includes('noreferrer')) add('link-rel', 'a rel', at);
  }
  if (tag === 'img') {
    const src = value('src');
    if (src === undefined || options.isAssetUrl?.(src) !== true) add('img-src', 'img src', at);
    if (value('alt') === undefined) add('img-alt', 'img alt', at);
  }
}

// A page nobody can submit is refused at save: the pair comes in order,
// together, and holds the parts that belong inside it.
function checkForm(manifest: PageManifest, slots: ReturnType<typeof scanSlots>, add: Add): void {
  const at = (name: string): number[] =>
    slots.filter((slot) => slot.kind === 'part' && slot.name === name).map((slot) => slot.index);
  const [open, close] = [at('form.open'), at('form.close')];
  const first = open[0];
  const last = close[0];
  if (open.length !== close.length) add('form-pair', 'form.open and form.close come together');
  else if (first !== undefined && last !== undefined && first > last) {
    add('form-pair', 'form.open comes before form.close', last);
  }
  for (const name of manifest.inForm) {
    for (const index of at(name)) {
      const inside = first !== undefined && last !== undefined && index > first && index < last;
      if (!inside) add('form-placement', name, index);
    }
  }
}

function checkManifest(
  kind: PageKind,
  slots: ReturnType<typeof scanSlots>,
  add: Add,
  options: TemplateOptions,
): void {
  const manifest = PAGE_KINDS[kind];
  const counts = new Map<string, number>();
  for (const slot of slots) {
    if (slot.kind === 'malformed') {
      add('malformed-slot', `at ${String(slot.index)}`, slot.index);
    } else if (slot.kind === 'text') {
      if (options.isMessageKey?.(slot.name) === false) {
        add('unknown-message-key', slot.name, slot.index);
      }
    } else {
      counts.set(slot.name, (counts.get(slot.name) ?? 0) + 1);
    }
  }
  for (const slot of slots) {
    if (
      slot.kind === 'part' &&
      !manifest.required.includes(slot.name) &&
      !manifest.optional.includes(slot.name)
    ) {
      add('unknown-slot', slot.name, slot.index);
    }
  }
  for (const name of manifest.required) {
    if (!counts.has(name)) add('missing-part', name);
  }
  checkForm(manifest, slots, add);
  const seen = new Map<string, number>();
  for (const slot of slots) {
    if (slot.kind !== 'part') continue;
    const times = (seen.get(slot.name) ?? 0) + 1;
    seen.set(slot.name, times);
    const known = manifest.required.includes(slot.name) || manifest.optional.includes(slot.name);
    if (times === 2 && known) add('repeated-part', slot.name, slot.index);
  }
}

// Fail closed: a template is accepted only if every element, attribute and
// slot in it is recognised. The tree is read, never serialised back out, so
// what is checked is what the parser saw and the template text itself is
// what gets filled.
// `{{t "key"}}` keys are checked against a catalogue only when the caller
// supplies `isMessageKey`; otherwise the `t` callback given to fillTemplate
// decides what an unknown key does.
export function checkTemplate(
  kind: PageKind,
  template: string,
  options: TemplateOptions = {},
): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const lineStarts = [0];
  for (let i = template.indexOf('\n'); i !== -1; i = template.indexOf('\n', i + 1)) {
    lineStarts.push(i + 1);
  }
  const position = (offset: number | undefined): { line: number | null; column: number | null } => {
    if (offset === undefined) return { line: null, column: null };
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((lineStarts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 };
  };
  const add: Add = (code, detail, offset) => {
    const seen = issues.some((issue) => issue.code === code && issue.detail === detail);
    // Past the cap only a kind of problem not yet listed still gets a line,
    // so the list stays bounded by the cap plus the number of kinds.
    const room = issues.length < MAX_ISSUES || !issues.some((issue) => issue.code === code);
    if (!seen && room) issues.push({ code, detail, ...position(offset) });
  };
  if (template.length > MAX_TEMPLATE_LENGTH) {
    add('too-large', `${String(template.length)} characters`);
    return issues;
  }
  const slots = scanSlots(template);
  if (slots.length > MAX_TEMPLATE_SLOTS) {
    add('too-many-slots', String(slots.length));
    return issues;
  }
  checkManifest(kind, slots, add, options);

  // The source is what gets filled, so a tag the parser would drop here
  // (frame, a second body whose attributes would merge onto the page's) is
  // refused by name. The same linear scan bounds nesting and count before
  // the parser, whose cost outgrows its input, sees the template. It can
  // read a few levels shallower than the tree (implied tbody and tr), so
  // the tree walk's depth check is the authority. A tag name inside an
  // attribute value matches too: a benign false positive.
  const sourceTags: number[] = [];
  const open: string[] = [];
  let elements = 0;
  for (const match of template.matchAll(TAG_NAME)) {
    const name = (match[2] ?? '').toLowerCase();
    if (!ALLOWED_ELEMENTS.has(name)) add('element-not-allowed', name, match.index);
    if (match[1] === '/') {
      if (open[open.length - 1] === name) open.pop();
      continue;
    }
    elements += 1;
    sourceTags.push(match.index);
    if (!VOID_ELEMENTS.has(name)) open.push(name);
    if (open.length > MAX_TEMPLATE_DEPTH) {
      add('too-deep', String(MAX_TEMPLATE_DEPTH), match.index);
      return issues;
    }
    if (elements > MAX_TEMPLATE_ELEMENTS) {
      add('too-many-elements', String(MAX_TEMPLATE_ELEMENTS), match.index);
      return issues;
    }
  }

  // The parser reports end of input where it ran out; the editor needs the
  // tag or comment that was left open.
  const constructStart = (code: string, atEnd: number): number => {
    if (code === 'eof-in-tag') return sourceTags[sourceTags.length - 1] ?? atEnd;
    if (code === 'eof-in-comment') {
      const start = template.lastIndexOf('<!--', atEnd);
      return start === -1 ? atEnd : start;
    }
    return atEnd;
  };

  const body = defaultTreeAdapter.createElement('body', html.NS.HTML, []);
  // A tag left open at the end would swallow the markup the server puts
  // after the template, so any end-of-input error refuses the template.
  const fragment = parseFragment(body, template, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (!error.code.startsWith('eof-')) return;
      add('unterminated', error.code, constructStart(error.code, error.startOffset));
    },
  });
  // Where each element's own start tag begins; an element the parser made up
  // (an implied tbody) has none.
  const explicit = new Set<number>();
  // Slots the parser saw in text. A slot written with entities, or one a
  // tag splits, never matches the source's count.
  let slotsInText = 0;
  // Where the form's two halves sit: a browser closes a form at the end of
  // the cell or paragraph it was opened in, whatever came before its close.
  const formParents = new Map<string, Node | null>();
  let treeElements = 0;
  const checkOrder = (children: Node[]): void => {
    const at = firstLifted(children);
    if (at !== null) add('part-placement', 'markup between table parts', at);
  };
  checkOrder(fragment.childNodes);
  const stack: { node: Node; depth: number }[] = fragment.childNodes
    .toReversed()
    .map((node) => ({ node, depth: 1 }));
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    const { node, depth } = entry;
    if (defaultTreeAdapter.isCommentNode(node)) {
      add('comment', 'comments are not allowed', node.sourceCodeLocation?.startOffset);
    } else if (defaultTreeAdapter.isTextNode(node)) {
      const parent = node.parentNode;
      const inRawText =
        parent !== null && defaultTreeAdapter.isElementNode(parent) && RAW_TEXT.has(parent.tagName);
      if (inRawText && HAS_BRACES.test(node.value)) {
        add('slot-in-raw-text', parent.tagName, parent.sourceCodeLocation?.startTag?.startOffset);
      } else if (!inRawText) {
        const found = scanSlots(node.value).filter((slot) => slot.kind !== 'malformed');
        slotsInText += found.length;
        const parts = found.filter((slot) => slot.kind === 'part');
        const at = node.sourceCodeLocation?.startOffset;
        for (const part of parts) {
          if (part.name === 'form.open' || part.name === 'form.close') {
            formParents.set(part.name, parent);
          }
        }
        const holder = parent !== null && defaultTreeAdapter.isElementNode(parent);
        if (parts.length > 0 && holder && NOT_FOR_PARTS.has(parent.tagName)) {
          add('part-placement', `${parts[0]?.name ?? ''} in ${parent.tagName}`, at);
        }
      }
    } else if (defaultTreeAdapter.isElementNode(node)) {
      treeElements += 1;
      if (treeElements > MAX_TEMPLATE_ELEMENTS) {
        add(
          'too-many-elements',
          String(MAX_TEMPLATE_ELEMENTS),
          node.sourceCodeLocation?.startOffset,
        );
        break;
      }
      const location = node.sourceCodeLocation;
      const here = location?.startTag?.startOffset;
      if (location?.startTag !== undefined) {
        explicit.add(location.startTag.startOffset);
        if (location.endTag === undefined && !OMISSIBLE_END.has(node.tagName)) {
          add('unclosed-element', `${node.tagName} has no end tag in the source`, here);
        }
      }
      if (depth > MAX_TEMPLATE_DEPTH) {
        add('too-deep', String(MAX_TEMPLATE_DEPTH), here);
        continue;
      }
      if (node.namespaceURI !== html.NS.HTML || !ALLOWED_ELEMENTS.has(node.tagName)) {
        add('element-not-allowed', node.tagName, here);
      } else {
        checkAttributes(node, options, add);
      }
      checkOrder(node.childNodes);
      for (const child of node.childNodes.toReversed()) {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  if (
    formParents.has('form.open') &&
    formParents.has('form.close') &&
    formParents.get('form.open') !== formParents.get('form.close')
  ) {
    add(
      'form-pair',
      'form.open and form.close must be in the same element, not split across cells',
    );
  }
  for (const offset of sourceTags) {
    if (!explicit.has(offset)) add('unparsed-tag', template.slice(offset, offset + 16), offset);
  }
  const slotsInSource = slots.filter((slot) => slot.kind !== 'malformed').length;
  // Only when nothing else was found: a slot in an attribute or a comment
  // also lowers the text count, and its own issue already says so.
  if (slotsInText !== slotsInSource && issues.length === 0) {
    add('malformed-slot', 'a slot the parser does not read as text');
  }
  return issues;
}
