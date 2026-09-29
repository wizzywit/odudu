import { describe, expect, it } from 'vitest';
import { previewable, urlProblem } from '#/shared/service/profileUrl.ts';

describe('urlProblem', () => {
  it('accepts nothing, and an http or https address', () => {
    expect(urlProblem('')).toBeNull();
    expect(urlProblem('https://example.com/ada')).toBeNull();
    expect(urlProblem('http://example.com/ada.png')).toBeNull();
  });

  it('refuses any other scheme, and an address that does not parse', () => {
    expect(urlProblem('example.com')).toBe('Start it with https:// or http://.');
    expect(urlProblem('javascript:alert(1)')).toBe('Start it with https:// or http://.');
    expect(urlProblem('https://')).toBe('This is not a complete address.');
  });
});

describe('previewable', () => {
  it('previews only a picture the console’s own origin serves', () => {
    expect(previewable('https://console.test/a.png', 'https://console.test')).toBe(true);
    expect(previewable('https://cdn.example/a.png', 'https://console.test')).toBe(false);
    expect(previewable('not a url', 'https://console.test')).toBe(false);
  });
});
