import { PAGE_KINDS, fillTemplate } from '@odudu/kernel';
import { defaultTreeAdapter, html, parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { describe, expect, it } from 'vitest';
import { checkTemplate } from '#/service/template';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type Document = DefaultTreeAdapterMap['document'];

// What a browser does with the filled page is what a person sees, so a
// template the checker accepts has to read the same way when parsed whole,
// with the server's own markup in its slots, as when the checker parsed it
// alone: no element changes parent, appears twice or goes missing, and the
// server's form still holds the server's controls.
const PARTS: Record<string, string> = {
  'form.open':
    '<form data-srv method="post" action="/x"><input data-srv data-in type="hidden" name="h">',
  'form.close': '</form>',
  fields: '<label data-srv data-in><input data-srv data-in name="u"></label>',
  submit: '<button data-srv data-in type="submit">Go</button>',
  error: '<p data-srv class="alert">e</p>',
  intro: '<div data-srv><h1 data-srv>Hi</h1></div>',
  links: '<p data-srv><a data-srv href="/l">l</a></p>',
  passkey: '<p data-srv><button data-srv type="button">p</button></p>',
};

const REQUIRED = ['{{error}}', '{{form.open}}', '{{fields}}', '{{submit}}', '{{form.close}}'];

const TRANSPARENT = new Set(
  'p a b i em strong s small sub sup code span mark q cite abbr bdi bdo time u'.split(' '),
);

const isElement = (node: Node): node is Element => defaultTreeAdapter.isElementNode(node);
const isServer = (el: Element): boolean => el.attrs.some((a) => a.name === 'data-srv');

// The template's own elements as nested tag names, the server's elements
// left out.
type Shape = (string | Shape)[];
function shapeOf(parent: { childNodes: Node[] }): Shape {
  const out: Shape = [];
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue;
    if (isServer(child)) {
      out.push(...shapeOf(child));
      continue;
    }
    // Only block structure is compared: a paragraph is closed by any block
    // the server puts in it and an inline element is reopened inside the next
    // one, which changes how it is drawn and not what the page holds.
    if (TRANSPARENT.has(child.tagName)) out.push(...shapeOf(child));
    else out.push(child.tagName, shapeOf(child));
  }
  return out;
}

function elements(parent: { childNodes: Node[] }, into: Element[] = []): Element[] {
  for (const child of parent.childNodes) {
    if (isElement(child)) {
      into.push(child);
      elements(child, into);
    }
  }
  return into;
}

function fragmentOf(template: string): { childNodes: Node[] } {
  const body = defaultTreeAdapter.createElement('body', html.NS.HTML, []);
  return parseFragment(body, template, {});
}

function filledDocument(template: string): Document {
  const filled = fillTemplate(template, PARTS, (key) => key);
  return parse(`<!doctype html><html><head><title>t</title></head><body>${filled}</body></html>`);
}

function bodyOf(document: Document): Element {
  const found = elements(document).find((el) => el.tagName === 'body');
  if (found === undefined) throw new Error('no body');
  return found;
}

// Everything wrong with the filled page that the checker's parse did not
// predict.
function disagreements(template: string): string[] {
  const body = bodyOf(filledDocument(template));
  const found: string[] = [];
  const all = elements(body);
  const forms = all.filter((el) => el.tagName === 'form');
  if (forms.length !== 1) found.push(`${String(forms.length)} forms`);
  const form = forms[0];
  const inside = form === undefined ? [] : elements(form);
  for (const el of all.filter((e) => e.attrs.some((a) => a.name === 'data-in'))) {
    if (!inside.includes(el)) found.push(`${el.tagName} outside the form`);
  }
  if (JSON.stringify(shapeOf(body)) !== JSON.stringify(shapeOf(fragmentOf(template)))) {
    found.push('the template changed shape');
  }
  return found;
}

describe('the checker parses a template as the browser parses the filled page', () => {
  const WRAPPERS: [string, string][] = [
    ['<table>', '</table>'],
    ['<tr>', '</tr>'],
    ['<td>', '</td>'],
    ['<th>', '</th>'],
    ['<tbody>', '</tbody>'],
    ['<thead>', '</thead>'],
    ['<caption>', '</caption>'],
    ['<p>', '</p>'],
    ['<div>', '</div>'],
    ['<ul>', '</ul>'],
    ['<li>', '</li>'],
    ['<b>', '</b>'],
    ['<em>', '</em>'],
    ['<span>', '</span>'],
    ['<h1>', '</h1>'],
    ['<section>', '</section>'],
    ['<dl><dt>', '</dt></dl>'],
    ['<a href="https://x.example" rel="noopener noreferrer">', '</a>'],
    ['<table><tr><td>', '</td></tr></table>'],
  ];
  const SINGLES = ['<br>', 'text', '&lt;', '{{intro}}', '{{links}}', '{{passkey}}', '<hr>', '</p>'];

  function rng(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('finds no accepted template whose filled page reads differently', () => {
    const next = rng(20261029);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
    let accepted = 0;
    const wrong: string[] = [];
    for (let i = 0; i < 6000; i += 1) {
      const tokens = [...REQUIRED];
      const put = (token: string, at: number): void => {
        tokens.splice(at, 0, token);
      };
      for (let k = 0; k < 1 + Math.floor(next() * 4); k += 1) {
        if (next() < 0.3) {
          put(pick(SINGLES), Math.floor(next() * (tokens.length + 1)));
        } else {
          const [open, close] = pick(WRAPPERS);
          const from = Math.floor(next() * (tokens.length + 1));
          const to = from + Math.floor(next() * (tokens.length + 1 - from));
          put(close, to);
          put(open, from);
        }
      }
      const template = tokens.join('');
      if (checkTemplate('sign-in', template).length > 0) continue;
      accepted += 1;
      const found = disagreements(template);
      if (found.length > 0) wrong.push(`${template}  =>  ${found.join(', ')}`);
    }
    expect(accepted).toBeGreaterThan(200);
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  const ADVERSARIAL: [string, string][] = [
    [
      'a table around the form parts',
      '<table>{{form.open}}<tr><td>{{fields}}{{submit}}</td></tr>{{form.close}}</table>{{error}}',
    ],
    [
      'the form open inside a cell',
      '<table><tr><td>{{form.open}}</td><td>{{fields}}{{submit}}{{form.close}}</td></tr></table>{{error}}',
    ],
    [
      'a select around the parts',
      '<select>{{form.open}}{{fields}}{{submit}}{{form.close}}</select>{{error}}',
    ],
    ['a form of its own', '<form>{{form.open}}{{fields}}{{submit}}{{form.close}}</form>{{error}}'],
    [
      'a form open inside another',
      '{{form.open}}<form>{{fields}}{{submit}}</form>{{form.close}}{{error}}',
    ],
    ['a slot split by a tag', '{{fo<b>rm</b>.open}}{{fields}}{{submit}}{{form.close}}{{error}}'],
    [
      'a paragraph open across the form',
      '<p>{{form.open}}{{fields}}{{submit}}{{form.close}}</p>{{error}}',
    ],
    [
      'a list around the error',
      '<ul><li>{{error}}</li></ul>{{form.open}}{{fields}}{{submit}}{{form.close}}',
    ],
    [
      'a heading around the form',
      '<h1>{{form.open}}{{fields}}{{submit}}{{form.close}}</h1>{{error}}',
    ],
    [
      'a caption holding a part',
      '<table><caption>{{error}}</caption><tr><td>x</td></tr></table>{{form.open}}{{fields}}{{submit}}{{form.close}}',
    ],
  ];

  it.each(ADVERSARIAL)('%s: refused, or read the same way', (_name, template) => {
    if (checkTemplate('sign-in', template).length > 0) return;
    expect(disagreements(template)).toEqual([]);
  });

  it('is not vacuous: a plain template is accepted and agrees', () => {
    const plain = `<div class="card">{{intro}}{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>`;
    expect(checkTemplate('sign-in', plain)).toEqual([]);
    expect(disagreements(plain)).toEqual([]);
  });

  it('knows its own manifest: the parts it fills are the sign-in kind', () => {
    const manifest = PAGE_KINDS['sign-in'];
    for (const name of [...manifest.required, ...manifest.optional]) {
      expect(PARTS[name], name).toBeDefined();
    }
  });
});
