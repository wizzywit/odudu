import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKER_LIMIT, templateTokens } from '#/shared/service/code/template';
import type { CodeToken } from '#/shared/service/code/tokens';

function joined(tokens: readonly CodeToken[]): string {
  return tokens.map((token) => token.text).join('');
}

function of(tokens: readonly CodeToken[], kind: CodeToken['kind']): string[] {
  return tokens.filter((token) => token.kind === kind).map((token) => token.text);
}

describe('templateTokens', () => {
  it('colours tags, attributes, strings and markers', () => {
    const source =
      '<main class="a">{{intro}}<h1>{{t "sign-in.title"}}</h1>{{form.open}}{{fields}}</main>';
    const tokens = templateTokens(source);
    expect(joined(tokens)).toBe(source);
    expect(of(tokens, 'part')).toEqual([
      '{{intro}}',
      '{{t "sign-in.title"}}',
      '{{form.open}}{{fields}}',
    ]);
    expect(of(tokens, 'attribute')).toEqual(['class']);
    expect(of(tokens, 'string')).toEqual(['"a"']);
    expect(of(tokens, 'tag')).toEqual(['<main', '>', '<h1>', '</h1>', '</main>']);
  });

  it('reads comments, unquoted values and self-closing tags', () => {
    const source = '<!-- note -->\n<br />text<a href=https://x.test/y rel="noopener">go</a>';
    const tokens = templateTokens(source);
    expect(joined(tokens)).toBe(source);
    expect(of(tokens, 'comment')).toEqual(['<!-- note -->']);
    expect(of(tokens, 'string')).toEqual(['https://x.test/y', '"noopener"']);
    expect(of(tokens, 'tag')).toContain('/>');
  });

  it('reads a marker in an attribute as a part', () => {
    expect(of(templateTokens('<a {{links}}>'), 'part')).toEqual(['{{links}}']);
  });

  it('leaves a lone angle bracket and text as text', () => {
    const tokens = templateTokens('1 < 2 and 3 > 2');
    expect(tokens).toEqual([{ kind: 'plain', text: '1 < 2 and 3 > 2' }]);
  });

  it('is empty for nothing', () => {
    expect(templateTokens('')).toEqual([]);
  });

  describe('text that is broken', () => {
    it.each([
      ['an unterminated comment', '<!-- never'],
      ['an unterminated tag', '<div class="a'],
      ['a tag broken by another', '<div <span>x</span>'],
      ['an unclosed marker', '{{intro'],
      ['a marker across lines', '{{a\nb}}'],
      ['a lone brace pair', '{{'],
      ['a closing slash alone', '</'],
      ['equals signs', '<a ==="x"=>'],
      ['nothing but openers', '<{{<{{<'],
    ])('keeps every character of %s', (_name, source) => {
      const tokens = templateTokens(source);
      expect(joined(tokens)).toBe(source);
      expect(tokens.every((token) => token.text !== '')).toBe(true);
    });

    it('does not read a marker that closes too far away', () => {
      const source = `{{${'a'.repeat(MARKER_LIMIT + 5)}}}`;
      expect(of(templateTokens(source), 'part')).toEqual([]);
    });

    it('hands the rest back as text when a tag is broken off', () => {
      const tokens = templateTokens('<div <span>x</span>');
      expect(of(tokens, 'tag')).toEqual(['<div', '<span>', '</span>']);
    });
  });

  describe('size', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('reads each character a bounded number of times for many unclosed openers', () => {
      const source = '{{ x '.repeat(8000);
      const spy = vi.spyOn(String.prototype, 'charCodeAt');
      const tokens = templateTokens(source);
      // An opener looks ahead at most MARKER_LIMIT characters for its close,
      // and an opener comes every five.
      expect(spy.mock.calls.length).toBeLessThanOrEqual((MARKER_LIMIT / 5 + 10) * source.length);
      expect(joined(tokens)).toBe(source);
    });

    it('reads a very long single line', () => {
      const source = `<p>${'word '.repeat(9000)}</p>`;
      const tokens = templateTokens(source);
      expect(joined(tokens)).toBe(source);
    });

    it('stays linear for many unterminated tags', () => {
      const source = '<a b="'.repeat(7000);
      expect(joined(templateTokens(source))).toBe(source);
    });
  });
});
