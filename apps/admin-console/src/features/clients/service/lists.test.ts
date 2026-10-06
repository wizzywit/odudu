import { describe, expect, it } from 'vitest';
import {
  CLIENT_LIST_LIMIT,
  entriesOf,
  listCount,
  namesText,
} from '#/features/clients/service/lists.ts';

const rows = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `row ${String(i)}`);

it('reads a list against the limit the server holds', () => {
  expect(CLIENT_LIST_LIMIT).toBe(200);
  expect(listCount([], 200, 'redirect URIs')).toBe('0 of 200 redirect URIs.');
  expect(listCount(rows(200), 200, 'redirect URIs')).toBe('200 of 200 redirect URIs.');
  expect(listCount(rows(203), 200, 'web origins')).toBe('3 over the limit of 200 web origins.');
});

it('counts a row left empty as nothing', () => {
  expect(listCount(['https://a.example', '', '  '], 200, 'web origins')).toBe(
    '1 of 200 web origins.',
  );
});

it('takes a row left empty or padded to be no entry, once, for the count and for what is sent', () => {
  expect(entriesOf(['https://a.example/cb ', '', '  '])).toEqual(['https://a.example/cb']);
});

describe('namesText', () => {
  it('lists names as a sentence, or says none', () => {
    expect(namesText(['a', 'b', 'c'])).toBe('a, b and c');
    expect(namesText(['a'])).toBe('a');
    expect(namesText([])).toBe('none');
    expect(namesText(null)).toBe('none');
  });
});
