import { describe, expect, it } from 'vitest';
import { pageShots, shotsOfSize } from '@site/src/features/landing/services/pageShot';

describe('the server page pictures', () => {
  it('names the two captures of a page under the server-pages folder', () => {
    expect(pageShots.addressOf('sign-in', 'light')).toBe('/server-pages/sign-in-light.webp');
    expect(pageShots.addressOf('sign-in', 'dark')).toBe('/server-pages/sign-in-dark.webp');
  });

  it('reads a size from the manifest the capture wrote', () => {
    expect(pageShots.sizeOf('sign-in').width).toBe(460);
    expect(pageShots.sizeOf('look-other')).toEqual(pageShots.sizeOf('look-odudu'));
  });

  it('hands out the width and height alone, without the capture hash', () => {
    expect(pageShots.sizeOf('sign-in')).toEqual({ width: 460, height: 753 });
  });

  it('refuses a page the manifest does not know', () => {
    expect(() => pageShots.sizeOf('no-such-page')).toThrow(
      'no server page capture named no-such-page',
    );
  });

  it('splits the four pages into the large pair and the small pair, in order', () => {
    expect(shotsOfSize('large').map((shot) => shot.name)).toEqual(['sign-in', 'create-account']);
    expect(shotsOfSize('small').map((shot) => shot.name)).toEqual([
      'reset-password',
      'second-factor',
    ]);
  });
});
