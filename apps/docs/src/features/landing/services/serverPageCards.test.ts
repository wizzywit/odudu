import { describe, expect, it } from 'vitest';
import { PAGE_SHOTS } from '@site/src/features/landing/services/serverPageCards';
import manifest from '@site/static/server-pages/manifest.json';

describe('the server page cards', () => {
  it('shows only server pages the capture has written', () => {
    expect(PAGE_SHOTS).toHaveLength(4);
    for (const shot of PAGE_SHOTS) expect(Object.keys(manifest)).toContain(shot.name);
  });
});
