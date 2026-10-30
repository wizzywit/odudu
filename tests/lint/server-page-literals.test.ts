import { readFile, glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createTranslators } from '../../packages/i18n/src/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURES = path.join(import.meta.dirname, 'fixtures/literals');

// A user-facing sentence is an entry in a catalogue (ADR 0043). This reads each
// server renderer as TypeScript and reports text a person would read that is
// typed in the file. The renderers are derived, not listed: every file under a
// `src/view` that is a `*-html.ts` or builds a tag, and the mail templates.
// Out of scope by kind, with no allowlist or waiver: the RFC 9457 strings of
// console-gateway and protocol-admin, which a program reads and which build no
// tag, and developer-facing protocol text such as an `error_description`.

export interface Finding {
  readonly line: number;
  readonly text: string;
  readonly where: 'text' | 'attribute' | 'script' | 'title';
}

// What it cannot see, so green speaks only for the rest: text built in a route
// or usecase and passed in (the second check catches the one form that has
// happened, a `.message` handed to a renderer); a literal in a helper that is
// not a `*-html.ts`; text concatenated across statements or files; a one-word
// lower-case string outside markup, which reads as an identifier; the `value`
// of a `<button>`, which is what the form submits; a script sentence that
// arrives through a variable.

const BLANK = String.fromCodePoint(0xfffc);
const LETTERS = /\p{L}{2}/u;
const PROSE_ARGUMENT_CALLS = new Set(['page', 'escapeHtml', 'bdi']);
// Whatever the i18n API hands a renderer other than isolation takes a message
// id, never text, so a string given to it is not prose.
const CATALOGUE_ACCESSORS = new Set(
  Object.keys(createTranslators({ en: {} }, (value: string) => value)).filter(
    (name) => name !== 'catalogue' && name !== 'bdi',
  ),
);
const TEXT_ATTRIBUTES = new Set([
  'alt',
  'title',
  'placeholder',
  'aria-label',
  'label',
  'summary',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
]);
const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

function calleeName(call: ts.CallExpression): string {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return '';
}

function isStringish(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

function isConcatenation(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
}

function containsStringish(node: ts.Node): boolean {
  if (isStringish(node)) return true;
  if (ts.isParenthesizedExpression(node)) return containsStringish(node.expression);
  return isConcatenation(node) && (containsStringish(node.left) || containsStringish(node.right));
}

// The text of one string expression with every `${...}` and every operand that
// is not a literal blanked, plus the sub-expressions that may hold literals.
function assemble(node: ts.Expression, inner: ts.Expression[]): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      inner.push(span.expression);
      text += BLANK + span.literal.text;
    }
    return text;
  }
  if (ts.isParenthesizedExpression(node)) return assemble(node.expression, inner);
  if (isConcatenation(node)) return assemble(node.left, inner) + assemble(node.right, inner);
  inner.push(node);
  return BLANK;
}

function isProse(text: string): boolean {
  const bare = text.replaceAll(BLANK, ' ').replace(/&[#\w]+;/gu, ' ');
  return LETTERS.test(bare);
}

// Outside markup a string is code as often as text, so only what reads as a
// sentence or a capitalised word counts.
function readsAsText(text: string): boolean {
  const bare = text.replaceAll(BLANK, ' ').trim();
  return /\p{L}{2,}\s+\p{L}{2,}/u.test(bare) || /^\p{Lu}\p{Ll}+/u.test(bare);
}

function lineIn(text: string, index: number, start: number): number {
  let line = start;
  for (let at = 0; at < index; at += 1) if (text[at] === '\n') line += 1;
  return line;
}

// A page template's two slot shapes (@odudu/kernel's slots.ts) name a part or
// a catalogue key and carry no text of their own.
const SLOT = /\{\{(?:[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*|t "[A-Za-z][\w.]*")\}\}/gu;

function inspect(source: string, start: number): Finding[] {
  const text = source.replace(SLOT, BLANK);
  const found: Finding[] = [];
  const quoted = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/gu;
  const scripts = /<script\b[^>]*>([\s\S]*?)<\/script>/giu;
  let rest = text;
  for (const script of text.matchAll(scripts)) {
    const body = script[1] ?? '';
    const bodyStart = script.index + script[0].indexOf(body);
    for (const string of body.matchAll(quoted)) {
      const value = string[2] ?? '';
      if (readsAsText(value))
        found.push({
          line: lineIn(text, bodyStart + string.index, start),
          text: value,
          where: 'script',
        });
    }
    rest = rest.replace(script[0], (whole) => whole.replace(/[^\n]/gu, ' '));
  }

  if (!/[<>]/u.test(rest)) {
    if (readsAsText(rest)) found.push({ line: start, text: rest.trim(), where: 'text' });
    return found;
  }

  for (const tag of rest.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/gu)) {
    const name = (tag[1] ?? '').toLowerCase();
    const attributes = tag[2] ?? '';
    const type = /\btype\s*=\s*["']?(submit|button|reset)/iu.test(attributes);
    const describes = /\bname\s*=\s*["']?description\b/iu.test(attributes);
    const values = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gu;
    for (const attribute of attributes.matchAll(values)) {
      const key = (attribute[1] ?? '').toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      const text =
        TEXT_ATTRIBUTES.has(key) ||
        (key === 'value' && name === 'input' && type) ||
        (key === 'content' && name === 'meta' && describes);
      const data = key.startsWith('data-') && readsAsText(value);
      if ((text && isProse(value)) || data) {
        found.push({
          line: lineIn(rest, tag.index, start),
          text: value,
          where: 'attribute',
        });
      }
    }
  }

  const nodes = rest.replace(/<[^>]*>/gu, '\u0001').split('\u0001');
  let offset = 0;
  for (const node of nodes) {
    if (isProse(node)) {
      found.push({
        line: lineIn(rest, rest.indexOf(node, offset), start),
        text: node.replaceAll(BLANK, '').trim(),
        where: 'text',
      });
    }
    offset += node.length;
  }
  return found;
}

function skipped(node: ts.Expression): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isLiteralTypeNode(parent) || ts.isCaseClause(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isBinaryExpression(parent) && COMPARISONS.has(parent.operatorToken.kind)) return true;
  if (ts.isTaggedTemplateExpression(parent)) return true;
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    return CATALOGUE_ACCESSORS.has(calleeName(parent));
  }
  return false;
}

export function findLiterals(source: string, fileName = 'renderer.ts'): Finding[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];

  function visit(node: ts.Node): void {
    if (ts.isExpression(node) && containsStringish(node) && !ts.isParenthesizedExpression(node)) {
      const inner: ts.Expression[] = [];
      const text = assemble(node, inner);
      if (!skipped(node)) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        const sentenceOnly =
          ts.isCallExpression(node.parent) &&
          node.parent.arguments.includes(node) &&
          !PROSE_ARGUMENT_CALLS.has(calleeName(node.parent)) &&
          !text.includes('<');
        const asTitle =
          ts.isCallExpression(node.parent) &&
          calleeName(node.parent) === 'page' &&
          node.parent.arguments[0] === node;
        if (sentenceOnly) {
          if (readsAsText(text)) found.push({ line, text: text.trim(), where: 'text' });
        } else if (asTitle) {
          if (isProse(text)) found.push({ line, text, where: 'title' });
        } else {
          found.push(...inspect(text, line));
        }
      }
      for (const expression of inner) visit(expression);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

describe('findLiterals', () => {
  it('reports the text of a page typed in the renderer, with its line', async () => {
    const source = await readFile(path.join(FIXTURES, 'bad-html.ts'), 'utf8');
    const found = findLiterals(source);
    expect(found.map((finding) => [finding.line, finding.text])).toEqual([
      [6, 'Sign in'],
      [7, 'Welcome back'],
      [8, 'Hello'],
    ]);
  });

  it('passes a renderer whose every sentence comes from the catalogue', async () => {
    const source = await readFile(path.join(FIXTURES, 'good-html.ts'), 'utf8');
    expect(findLiterals(source)).toEqual([]);
  });

  it('reads a template of slots as text-free, and a sentence beside them as text', async () => {
    const source = await readFile(path.join(FIXTURES, 'template-html.ts'), 'utf8');
    expect(findLiterals(source).map((finding) => finding.text)).toEqual(['Welcome back']);
  });

  it('does not take a malformed slot for a slot', () => {
    expect(findLiterals('export const x = `<p>{{ Sign in }}</p>`;').map((f) => f.text)).toEqual([
      '{{ Sign in }}',
    ]);
  });

  it('reports a sentence inside a script body', async () => {
    const source = await readFile(path.join(FIXTURES, 'script-html.ts'), 'utf8');
    const found = findLiterals(source);
    expect(found.map((finding) => [finding.where, finding.text])).toEqual([
      ['script', 'Something went wrong'],
    ]);
  });

  it('reassembles text split across concatenation and template spans', async () => {
    const source = await readFile(path.join(FIXTURES, 'split-html.ts'), 'utf8');
    const found = findLiterals(source);
    expect(found.map((finding) => finding.text)).toEqual(['Please wait', 'Please wait']);
  });

  it('reports a literal title passed to page()', async () => {
    const source = await readFile(path.join(FIXTURES, 'page-title-html.ts'), 'utf8');
    expect(findLiterals(source).map((finding) => [finding.where, finding.text])).toEqual([
      ['title', 'Account settings'],
    ]);
  });

  it('reports alt, title, placeholder, aria-label and the value of an input that submits', async () => {
    const source = await readFile(path.join(FIXTURES, 'attributes-html.ts'), 'utf8');
    const found = findLiterals(source)
      .filter((finding) => finding.where === 'attribute')
      .map((finding) => finding.text);
    expect(found).toEqual([
      'Company logo',
      'Open the page',
      'Your name',
      'Close dialog',
      'Send now',
    ]);
  });

  it('ignores comments, import paths, property names and comparisons', () => {
    const source = `import { x } from 'some-package';
// A sentence in a comment.
/* Another one. */
const key = { 'content-type': 1 };
export const same = (v: string) => v === 'hello world';`;
    expect(findLiterals(source)).toEqual([]);
  });
});

const REQUEST_ERROR_HELPER = /^(render[A-Z]\w*|send\w*Error\w*)$/u;

function readsMessage(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'message';
  return (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === 'message'
  );
}

function anyNode(node: ts.Node, found: (node: ts.Node) => boolean): boolean {
  return (
    found(node) || ts.forEachChild(node, (child) => anyNode(child, found) || undefined) === true
  );
}

// A domain value's `.message` is developer-facing English: a view maps the
// value's code to a sentence of its own catalogue instead. Handing the message
// to a renderer or a request-error helper puts it in front of a person, also
// through a local alias, a destructured `message` or a bracket access. The
// deliberate fallback `bdi(violation.message)` in a renderer (an unknown rule
// code shows the domain's sentence, isolated) is a call to neither, so it is
// not reported.
export function findMessageLeaks(source: string, fileName = 'route.ts'): Finding[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];
  const tainted = new Set<string>();

  function collect(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      anyNode(node.initializer, readsMessage)
    ) {
      tainted.add(node.name.text);
    }
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      (node.propertyName ?? node.name).getText(file) === 'message'
    ) {
      tainted.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  }
  collect(file);

  function leaks(node: ts.Node): boolean {
    if (readsMessage(node)) return true;
    if (!ts.isIdentifier(node) || !tainted.has(node.text)) return false;
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    return !(ts.isPropertyAssignment(parent) && parent.name === node);
  }

  function report(node: ts.Node, call: ts.CallExpression): void {
    if (leaks(node)) {
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      found.push({ line, text: `${calleeName(call)}(... ${node.getText(file)})`, where: 'text' });
      return;
    }
    ts.forEachChild(node, (child) => {
      report(child, call);
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && REQUEST_ERROR_HELPER.test(calleeName(node))) {
      for (const argument of node.arguments) report(argument, node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

describe('findMessageLeaks', () => {
  it('reports a .message handed to a renderer or a request-error helper', async () => {
    const source = await readFile(path.join(FIXTURES, 'message-leak-html.ts'), 'utf8');
    expect(findMessageLeaks(source).map((finding) => finding.line)).toEqual([6, 7]);
  });

  it('passes a violation handed over whole and a message read for other ends', async () => {
    const source = await readFile(path.join(FIXTURES, 'message-clean-html.ts'), 'utf8');
    expect(findMessageLeaks(source)).toEqual([]);
  });
});

const TAG = /<[a-zA-Z!][^<>]*>/u;

// A file is a renderer when it builds a tag, whatever it is called: a helper
// that returns markup is held to the rule as much as a `*-html.ts`.
export function carriesMarkup(source: string): boolean {
  const file = ts.createSourceFile('file.ts', source, ts.ScriptTarget.Latest, true);
  let found = false;
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found ||= TAG.test(node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      found ||= TAG.test(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

async function repoFiles(pattern: string): Promise<string[]> {
  const found: string[] = [];
  for await (const file of glob(pattern, {
    cwd: REPO_ROOT,
    exclude: (entry) => path.basename(entry) === 'node_modules',
  })) {
    if (!file.endsWith('.test.ts')) found.push(file);
  }
  return found.sort();
}

// Derived, never listed: every non-test file under a package's `src/view` that
// is a `*-html.ts` or builds a tag, and the mail templates. A catalogue
// (`messages.ts`) is where the text lives, and the API problem-details helpers
// build no tag, so they fall out by what they are rather than by name.
async function renderers(): Promise<string[]> {
  const candidates = [
    ...(await repoFiles('packages/*/src/view/**/*.ts')),
    ...(await repoFiles('apps/*/src/view/**/*.ts')),
    ...(await repoFiles('packages/email/src/service/*.ts')),
  ];
  const found: string[] = [];
  for (const file of candidates) {
    const source = await readFile(path.join(REPO_ROOT, file), 'utf8');
    if (path.basename(file) === 'messages.ts') continue;
    if (file.endsWith('-html.ts') || file.endsWith('/templates.ts') || carriesMarkup(source)) {
      found.push(file);
    }
  }
  return found;
}

describe('the server renderers and mail templates', () => {
  it('finds no user-facing literal in any server renderer', async () => {
    const files = await renderers();
    expect(files).toEqual(
      expect.arrayContaining([
        'packages/account/src/view/form-error.ts',
        'packages/authn-flows/src/view/form-error.ts',
        'packages/protocol-oidc/src/view/document.ts',
        'packages/email/src/service/templates.ts',
        'packages/email/src/service/shell.ts',
      ]),
    );
    expect(files.length).toBeGreaterThan(18);

    const offences: string[] = [];
    for (const file of files) {
      const source = await readFile(path.join(REPO_ROOT, file), 'utf8');
      for (const finding of findLiterals(source, file)) {
        offences.push(`${file}:${String(finding.line)} ${finding.where}: ${finding.text}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('hands no .message of a domain value to a renderer or a request-error helper', async () => {
    const packages = new Set(
      (await repoFiles('packages/*/src/view/*-html.ts')).map((file) => file.split('/')[1]),
    );
    const files: string[] = [];
    for (const name of packages) {
      files.push(
        ...(await repoFiles(`packages/${String(name)}/src/view/*-html.ts`)),
        ...(await repoFiles(`packages/${String(name)}/src/view/routes/*.ts`)),
      );
    }
    expect(files.length).toBeGreaterThan(20);

    const offences: string[] = [];
    for (const file of files) {
      const source = await readFile(path.join(REPO_ROOT, file), 'utf8');
      for (const finding of findMessageLeaks(source, file)) {
        offences.push(`${file}:${String(finding.line)} ${finding.text}`);
      }
    }
    expect(offences).toEqual([]);
  });
});

describe('findLiterals, further forms', () => {
  it('reports a sentence handed to a helper inside markup, not a catalogue id', async () => {
    const source = await readFile(path.join(FIXTURES, 'helper-arg-html.ts'), 'utf8');
    expect(findLiterals(source).map((finding) => finding.text)).toEqual([
      'Hello there',
      'Ada Lovelace',
    ]);
  });

  it('reports label, aria-description, aria-roledescription, aria-valuetext and data-* text', async () => {
    const source = await readFile(path.join(FIXTURES, 'attributes-more-html.ts'), 'utf8');
    expect(findLiterals(source).map((finding) => finding.text)).toEqual([
      'Choose one',
      'Opens a dialog',
      'Slide deck',
      'Halfway there',
      'Press enter to continue',
      'Your_name',
      'A page about things',
    ]);
  });
});

describe('findMessageLeaks, further forms', () => {
  it('follows an alias, a bracket access and a destructured message into a renderer', async () => {
    const source = await readFile(path.join(FIXTURES, 'message-alias-html.ts'), 'utf8');
    expect(findMessageLeaks(source).map((finding) => finding.line)).toEqual([5, 9, 14]);
  });
});

describe('carriesMarkup', () => {
  it('holds a file that builds a tag, whatever it is called, and no other', async () => {
    const note = await readFile(path.join(FIXTURES, 'render-note.ts'), 'utf8');
    const problem = await readFile(path.join(FIXTURES, 'problem.ts'), 'utf8');
    expect(carriesMarkup(note)).toBe(true);
    expect(carriesMarkup(problem)).toBe(false);
  });
});
