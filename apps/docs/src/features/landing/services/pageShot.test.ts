import { describe, expect, it } from 'vitest';
import {
  pageShotAddress,
  pageShotSize,
  shotsOfSize,
} from '@site/src/features/landing/services/pageShot';

describe('the server page pictures', () => {
  it('names the two captures of a page under the server-pages folder', () => {
    expect(pageShotAddress('sign-in', 'light')).toBe('/server-pages/sign-in-light.webp');
    expect(pageShotAddress('sign-in', 'dark')).toBe('/server-pages/sign-in-dark.webp');
  });

  it('reads a size from the manifest the capture wrote', () => {
    expect(pageShotSize('sign-in').width).toBe(460);
    expect(pageShotSize('look-other')).toEqual(pageShotSize('look-odudu'));
  });

  it('refuses a page the manifest does not know', () => {
    expect(() => pageShotSize('no-such-page')).toThrow('no server page capture named no-such-page');
  });

  it('splits the four pages into the large pair and the small pair, in order', () => {
    expect(shotsOfSize('large').map((shot) => shot.name)).toEqual(['sign-in', 'create-account']);
    expect(shotsOfSize('small').map((shot) => shot.name)).toEqual([
      'reset-password',
      'second-factor',
    ]);
  });
});
