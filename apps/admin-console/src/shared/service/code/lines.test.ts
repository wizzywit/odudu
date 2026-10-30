import { describe, expect, it } from 'vitest';
import {
  gutterParts,
  lineCount,
  lineLabel,
  markedLines,
  tokensByLine,
} from '#/shared/service/code';

describe('lineCount', () => {
  it.each([
    ['', 1],
    ['a', 1],
    ['a\n', 2],
    ['\n\n', 3],
    ['a\nb\nc', 3],
  ])('counts %j as %i', (text, count) => {
    expect(lineCount(text)).toBe(count);
  });
});

describe('tokensByLine', () => {
  it('cuts at line breaks and continues a token on the next line', () => {
    const lines = tokensByLine([
      { kind: 'comment', text: '/* a\nb */' },
      { kind: 'plain', text: '\n' },
      { kind: 'selector', text: '.x' },
    ]);
    expect(lines).toEqual([
      [{ kind: 'comment', text: '/* a' }],
      [{ kind: 'comment', text: 'b */' }],
      [{ kind: 'selector', text: '.x' }],
    ]);
  });

  it('gives an empty text one empty line, as the field has', () => {
    expect(tokensByLine([])).toEqual([[]]);
    expect(tokensByLine([{ kind: 'plain', text: 'a\n' }])).toEqual([
      [{ kind: 'plain', text: 'a' }],
      [],
    ]);
  });
});

describe('gutterParts', () => {
  const text = (count: number, marked: number[]): string =>
    gutterParts(count, marked)
      .map((part) => part.text)
      .join('');

  it('is the numbers one to a line when nothing is marked', () => {
    expect(gutterParts(3, [])).toEqual([{ text: '1\n2\n3', marked: false }]);
  });

  it('stands a marked line alone and keeps the breaks', () => {
    expect(gutterParts(5, [3])).toEqual([
      { text: '1\n2\n', marked: false },
      { text: '3', marked: true },
      { text: '\n4\n5', marked: false },
    ]);
    expect(text(5, [3])).toBe('1\n2\n3\n4\n5');
  });

  it('marks the first line, the last, and neighbours', () => {
    expect(text(4, [1, 2, 4])).toBe('1\n2\n3\n4');
    expect(gutterParts(1, [1])).toEqual([{ text: '1', marked: true }]);
    expect(gutterParts(4, [1, 2, 4]).filter((part) => part.marked)).toHaveLength(3);
  });

  it('numbers a long text, one part either side of a mark', () => {
    const parts = gutterParts(130_000, [5]);
    expect(parts).toHaveLength(3);
    expect(parts[2]?.text.endsWith('\n130000')).toBe(true);
  });
});

describe('markedLines', () => {
  it('keeps lines that exist, once each, in order', () => {
    const issue = (line: number) => ({ line, text: 'x' });
    expect(markedLines([issue(5), issue(2), issue(5), issue(0), issue(99)], 10)).toEqual([2, 5]);
  });

  it('words a line for a person', () => {
    expect(lineLabel({ line: 3, text: 'The property is not allowed.' })).toBe(
      'Line 3: The property is not allowed.',
    );
  });
});
