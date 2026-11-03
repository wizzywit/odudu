import { describe, expect, it } from 'vitest';
import { dialogOpen, pathnameOf } from '#/widgets/shell/services/pageContext';

describe('the page context', () => {
  it('keeps a dialog from the shortcuts whether the host or the guard asks', () => {
    expect(dialogOpen(0, false)).toBe(false);
    expect(dialogOpen(1, false)).toBe(true);
    expect(dialogOpen(0, true)).toBe(true);
  });

  it('reads the path of the address the router reports', () => {
    expect(pathnameOf('/console/acme/roles?x=1#a', 'https://console.example')).toBe(
      '/console/acme/roles',
    );
  });
});
