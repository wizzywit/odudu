import { describe, expect, it } from 'vitest';
import { staleParts } from './dist-fresh.ts';

const sources = { tokensCss: ':root{--a:1}', pagesCss: '.page{margin:0}' };
const built = (tokens: string, pages: string): string => [tokens, 'fonts', pages].join('\n');

describe('staleParts', () => {
  it('is empty for a build of these sources', () => {
    expect(staleParts(built(sources.tokensCss, sources.pagesCss), sources)).toEqual([]);
  });

  it('names the source a build was made without', () => {
    expect(staleParts(built(sources.tokensCss, '.page{margin:1px}'), sources)).toEqual([
      'pages.css',
    ]);
    expect(staleParts(built(':root{--a:2}', sources.pagesCss), sources)).toEqual(['tokens.css']);
    expect(staleParts('', sources)).toEqual(['tokens.css', 'pages.css']);
  });
});
