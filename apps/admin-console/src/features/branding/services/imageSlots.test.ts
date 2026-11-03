import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_TYPE_LIST,
  ACCEPTED_TYPES,
  limitText,
  TENANT_IMAGE_CAP,
} from '#/features/branding/services/imageSlots';

describe('limits', () => {
  it('state the size and side of each kind', () => {
    expect(limitText('logo')).toContain('up to 256 KiB and 1024 pixels');
    expect(limitText('background')).toContain('up to 1 MiB and 2560 pixels');
  });
});

describe('what the tenant may hold in all', () => {
  it('reads 8 MiB, in the limit text too', () => {
    expect(TENANT_IMAGE_CAP).toBe('8 MiB');
    expect(limitText('favicon')).toMatch(/may total 8 MiB\.$/u);
  });
});

describe('the types an upload accepts', () => {
  it('are a PNG, a JPEG and a WebP, as a list and as the file picker names them', () => {
    expect(ACCEPTED_TYPE_LIST).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(ACCEPTED_TYPES).toBe('image/png,image/jpeg,image/webp');
  });
});
