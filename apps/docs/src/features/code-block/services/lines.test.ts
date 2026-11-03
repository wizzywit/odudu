import { describe, expect, it } from 'vitest';
import {
  blockClass,
  linesFor,
  lineProps,
  parseLines,
  plainLines,
  tokenClass,
  tokenProps,
} from '@site/src/features/code-block/services/lines';

describe('the lines a build wrote into a code block', () => {
  const written = JSON.stringify([[['keyword', 'select'], ' 1']]);

  it('read back as tokens, the unclassed text as plain', () => {
    expect(parseLines(written)).toEqual([
      [
        { types: ['keyword'], content: 'select' },
        { types: ['plain'], content: ' 1' },
      ],
    ]);
  });

  it('are nothing when absent or not lines', () => {
    expect(parseLines(undefined)).toBeUndefined();
    expect(parseLines('{}')).toBeUndefined();
    expect(parseLines('[[1]]')).toBeUndefined();
    expect(parseLines('{not json')).toBeUndefined();
  });

  it('colour the code they were written from', () => {
    expect(linesFor('select 1', parseLines(written))).toEqual(parseLines(written));
  });

  it('give way to plain text when the code is not what was highlighted', () => {
    expect(linesFor('select 2', parseLines(written))).toEqual(plainLines('select 2'));
    expect(linesFor('a\nb', undefined)).toHaveLength(2);
  });

  it('name a token by its classes and leave plain text unclassed', () => {
    expect(tokenClass(['string', 'attr-value'])).toBe('tok-string tok-attr-value');
    expect(tokenClass(['plain'])).toBeUndefined();
  });

  it('put the token-line class first and keep an extra one the theme asks for', () => {
    expect(lineProps(undefined)).toEqual({ className: 'token-line' });
    expect(lineProps('')).toEqual({ className: 'token-line' });
    expect(lineProps('highlight')).toEqual({ className: 'token-line highlight' });
  });

  it('give a token its classes and its text', () => {
    expect(tokenProps({ types: ['keyword'], content: 'select' })).toEqual({
      className: 'tok-keyword',
      children: 'select',
    });
    expect(tokenProps({ types: ['plain'], content: 'x' })).toEqual({
      className: undefined,
      children: 'x',
    });
  });

  it('name the block by its language', () => {
    expect(blockClass('json')).toBe('prism-code language-json');
  });
});
