import { describe, expect, it } from 'vitest';
import { hasInvisible } from '#/entities/assistant/services/textClean';
import {
  MARKDOWN_MAX_CHARS,
  SAFE_NODE_KINDS,
  renderSafeMarkdown,
  type SafeNode,
} from '#/entities/assistant/services/safeMarkdown';

function walk(nodes: readonly SafeNode[], visit: (node: SafeNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if ('children' in node) walk(node.children, visit);
  }
}

function kinds(nodes: readonly SafeNode[]): Set<string> {
  const seen = new Set<string>();
  walk(nodes, (node) => seen.add(node.kind));
  return seen;
}

function textOf(nodes: readonly SafeNode[]): string {
  let out = '';
  walk(nodes, (node) => {
    if (node.kind === 'text' || node.kind === 'code' || node.kind === 'pre') out += node.text;
  });
  return out;
}

function links(nodes: readonly SafeNode[]): string[] {
  const hrefs: string[] = [];
  walk(nodes, (node) => {
    if (node.kind === 'link') hrefs.push(node.href);
  });
  return hrefs;
}

function depthOf(nodes: readonly SafeNode[]): number {
  let deepest = 0;
  for (const node of nodes) {
    if ('children' in node) deepest = Math.max(deepest, 1 + depthOf(node.children));
  }
  return deepest;
}

describe('renderSafeMarkdown', () => {
  it('renders paragraphs, emphasis, code and lists', () => {
    const nodes = renderSafeMarkdown(
      'Hello **bold** and *soft* and `x`.\n\n- one\n- two\n\n1. first\n2. second\n\n```\nlet a = 1;\n```',
    );
    expect(nodes.map((node) => node.kind)).toEqual(['p', 'ul', 'ol', 'pre']);
    expect(kinds(nodes)).toEqual(
      new Set(['p', 'text', 'strong', 'em', 'code', 'ul', 'li', 'ol', 'pre']),
    );
    expect(textOf(nodes)).toContain('let a = 1;');
  });

  it('shows raw markup literally and never interprets it', () => {
    const text = textOf(
      renderSafeMarkdown(
        'List<String> x = new ArrayList<>(); GET /tenants/<tenant>/x if a<b and b>c',
      ),
    );
    expect(text).toBe('List<String> x = new ArrayList<>(); GET /tenants/<tenant>/x if a<b and b>c');
    expect(textOf(renderSafeMarkdown('<a href="x">t</a> and <script>alert(1)</script>'))).toBe(
      '<a href="x">t</a> and <script>alert(1)</script>',
    );
  });

  it('shows markup in code spans and fences literally too', () => {
    const text = textOf(
      renderSafeMarkdown('`Map<String,Integer>`\n\n```\nMap<String,Integer> m;\n```'),
    );
    expect(text).toContain('Map<String,Integer>Map<String,Integer> m;');
  });

  it('never lets an unterminated style or script element swallow the message', () => {
    expect(textOf(renderSafeMarkdown('<style>a{} text after'))).toBe('<style>a{} text after');
    expect(textOf(renderSafeMarkdown('safe <script>alert(1)'))).toBe('safe <script>alert(1)');
  });

  it('shows an angle-bracket address as text, not a link', () => {
    const nodes = renderSafeMarkdown('see <https://x>');
    expect(links(nodes)).toEqual([]);
    expect(textOf(nodes)).toBe('see <https://x>');
  });

  it('never makes an image element: a remote image becomes its alt text', () => {
    const nodes = renderSafeMarkdown(
      '![chart](http://evil.example/p.png?d=secret) ![](https://e/x)',
    );
    expect(textOf(nodes)).toContain('chart');
    expect(textOf(nodes)).not.toContain('evil.example');
    expect(textOf(nodes)).not.toContain('https://e/x');
    for (const kind of kinds(nodes)) expect(SAFE_NODE_KINDS).toContain(kind);
  });

  it('turns an external link into plain text with its address spelled out', () => {
    const nodes = renderSafeMarkdown('See [the docs](https://example.com/a?b=1).');
    expect(links(nodes)).toEqual([]);
    expect(textOf(nodes)).toBe('See the docs (https://example.com/a?b=1).');
  });

  it('drops a javascript, data or vbscript destination and keeps the label', () => {
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:x',
      'file:///etc/passwd',
    ]) {
      const nodes = renderSafeMarkdown(`[click me](${url})`);
      expect(links(nodes)).toEqual([]);
      expect(textOf(nodes)).toBe('click me');
    }
  });

  it('drops a destination with a lookalike scheme or host', () => {
    for (const url of [
      'jаvascript:alert(1)',
      'https://exаmple.com/',
      '//example.com/x',
      '\\\\example.com\\x',
    ]) {
      const nodes = renderSafeMarkdown(`[go](${url})`);
      expect(links(nodes)).toEqual([]);
      expect(textOf(nodes)).toBe('go');
    }
  });

  it('shows an address with an override character only once the character is gone', () => {
    const text = textOf(renderSafeMarkdown('[go](https://example.com/‮evil)'));
    expect(text).toBe('go (https://example.com/evil)');
  });

  it('keeps a link to a console page as a link, and nothing else', () => {
    const nodes = renderSafeMarkdown('Open [Grace](/console/acme/subjects/s1) now.');
    expect(links(nodes)).toEqual(['/console/acme/subjects/s1']);
    for (const bad of ['/consolex/a', '/console/../x', '/console/a b', '/console/a"onclick']) {
      expect(links(renderSafeMarkdown(`[x](${bad})`))).toEqual([]);
    }
  });

  it('keeps HTML in link text and in an alt text as text', () => {
    const nodes = renderSafeMarkdown(
      '[<b>hi</b>](https://e.example/) ![<i>alt</i>](http://e.example/x)',
    );
    expect(links(nodes)).toEqual([]);
    expect(textOf(nodes)).toBe('<b>hi</b> (https://e.example/) <i>alt</i>');
  });

  it('does not autolink a bare address', () => {
    const nodes = renderSafeMarkdown('visit https://example.com and <https://example.org>');
    expect(links(nodes)).toEqual([]);
    expect(textOf(nodes)).toContain('https://example.com');
  });

  it('survives an emphasis bomb without nesting past a fixed depth', () => {
    const bomb = `${'*a '.repeat(5_000)}${'* '.repeat(5_000)}`;
    expect(depthOf(renderSafeMarkdown(bomb))).toBeLessThanOrEqual(8);
    const nested = renderSafeMarkdown(`${'**_'.repeat(2_000)}x${'_**'.repeat(2_000)}`);
    expect(nested.length).toBeGreaterThan(0);
    expect(depthOf(nested)).toBeLessThanOrEqual(8);
  });

  it('stays fast on inputs that make every candidate scan far ahead', () => {
    const hostile = [
      '['.repeat(4_000) + '\n',
      '*x '.repeat(1_300) + '\n',
      '_a '.repeat(1_300) + '\n',
      '[a'.repeat(2_000) + '\n',
    ];
    for (const line of hostile) {
      const input = line.repeat(15);
      const started = performance.now();
      renderSafeMarkdown(input);
      // The quadratic scan took about 340 ms on these; linear work takes a few
      // ms, so 150 ms catches a regression and tolerates a loaded runner.
      expect(performance.now() - started, line.slice(0, 6)).toBeLessThan(150);
    }
  });

  it('bounds the work for a very long line and a very long input', () => {
    const started = performance.now();
    const line = renderSafeMarkdown('word '.repeat(MARKDOWN_MAX_CHARS));
    renderSafeMarkdown('[a](b'.repeat(20_000));
    renderSafeMarkdown('`'.repeat(100_000));
    renderSafeMarkdown('- x\n'.repeat(100_000));
    expect(performance.now() - started).toBeLessThan(500);
    expect(textOf(line).length).toBeLessThanOrEqual(MARKDOWN_MAX_CHARS + 200);
    expect(textOf(line)).toContain('too long');
  });

  it('caps how many nodes one message can make', () => {
    const nodes = renderSafeMarkdown('- x\n'.repeat(50_000));
    let count = 0;
    walk(nodes, () => {
      count += 1;
    });
    expect(count).toBeLessThanOrEqual(5_000);
  });

  it('strips control and bidi override characters', () => {
    expect(textOf(renderSafeMarkdown('a\u0000b‮c⁦d​e'))).toBe('abcde');
  });

  it('treats a heading as a bold line, not an element of its own', () => {
    const nodes = renderSafeMarkdown('# Title\n\nbody');
    expect(nodes.map((node) => node.kind)).toEqual(['p', 'p']);
    expect(kinds(nodes).has('strong')).toBe(true);
  });

  it('never makes an element outside the allowed set, whatever the input', () => {
    let seed = 0x2545f491;
    const next = (): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x1_0000_0000;
    };
    const pieces = [
      '<',
      '>',
      '</',
      '<script>',
      '</script>',
      '<img ',
      'onerror=',
      '![',
      '](',
      ')',
      '[',
      ']',
      '*',
      '**',
      '_',
      '__',
      '`',
      '```',
      '\n',
      '\n\n',
      '- ',
      '1. ',
      '# ',
      '> ',
      '\\',
      '&lt;',
      'javascript:',
      'http://x.y/',
      '/console/a',
      ' ',
      'word',
      'é',
      '‮',
      '\u0000',
    ];
    for (let run = 0; run < 400; run += 1) {
      let input = '';
      const length = Math.floor(next() * 60);
      for (let i = 0; i < length; i += 1) {
        input += pieces[Math.floor(next() * pieces.length)] ?? '';
      }
      const nodes = renderSafeMarkdown(input);
      for (const kind of kinds(nodes)) expect(SAFE_NODE_KINDS).toContain(kind);
      walk(nodes, (node) => {
        if ('text' in node) expect(hasInvisible(node.text)).toBe(false);
      });
      expect(depthOf(nodes)).toBeLessThanOrEqual(8);
      for (const href of links(nodes)) {
        expect(href).toMatch(/^\/console\/[A-Za-z0-9._~/-]*$/u);
        expect(href).not.toContain('..');
      }
    }
  });
});
