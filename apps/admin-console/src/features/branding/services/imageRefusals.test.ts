import { describe, expect, it } from 'vitest';
import {
  inUse,
  inUseTitle,
  uploadFailureText,
  uploadRefusal,
} from '#/features/branding/services/imageRefusals';

const problemOf = (type: string, status = 422, extra = {}) => ({
  type: `about:blank#${type}`,
  title: 'Refused',
  status,
  ...extra,
});

describe('a file against the limits', () => {
  it('refuse a file over its size or of another type before it is sent', () => {
    expect(uploadRefusal('logo', { type: 'image/gif', size: 1 })).toBe(
      'That is not a PNG, a JPEG or a WebP.',
    );
    expect(uploadRefusal('favicon', { type: 'image/png', size: 300 * 1024 })).toMatch(
      /over 256 KiB/u,
    );
    expect(uploadRefusal('background', { type: 'image/webp', size: 300 * 1024 })).toBeNull();
    expect(uploadRefusal('logo', { type: '', size: 10 })).toBeNull();
  });
});

describe('a refused upload', () => {
  it('says 413 as too large even with no problem type', () => {
    expect(uploadFailureText('background', problemOf('', 413))).toMatch(/over 1 MiB/u);
  });

  it('says anything unknown in general terms, never the server’s detail', () => {
    expect(uploadFailureText('logo', problemOf('mystery', 500, { detail: 'decoder: x' }))).toBe(
      'The image was not uploaded.',
    );
  });
});

describe('an image still in use', () => {
  const found = inUse(
    problemOf('asset-in-use', 409, {
      detail: 'a theme still names the image, more than errors lists',
      errors: [{ path: 'theme', message: 'named by the draft d' }],
    }),
  );

  it('lists the themes by path, and says when there are more', () => {
    expect(found?.lines).toEqual(['This tenant’s theme: named by the draft d.']);
    expect(found?.more).toBe(true);
    expect(found === null ? '' : inUseTitle(found)).toMatch(/still used by 1 theme or more/u);
  });

  it('is nothing for another problem', () => {
    expect(inUse(problemOf('asset-cap', 409))).toBeNull();
  });
});
