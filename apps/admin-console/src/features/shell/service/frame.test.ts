import { describe, expect, it } from 'vitest';
import { areaAt } from '#/features/shell/service/areas.ts';
import {
  areasLabel,
  brandText,
  checkingText,
  dialogOpen,
  notBuiltText,
  pathnameOf,
  signedInFrom,
  tenantNotFoundText,
} from '#/features/shell/service/frame.ts';

describe('the frame text', () => {
  it('names the tenant in the brand and the rail', () => {
    expect(brandText('acme')).toBe('odudu · acme');
    expect(areasLabel('acme')).toBe('Areas of acme');
  });

  it('says whose session it is only when it came from another tenant', () => {
    expect(signedInFrom('acme', 'acme')).toBeNull();
    expect(signedInFrom('system', 'acme')).toBe('system');
  });

  it('says what an area is doing before it opens', () => {
    expect(checkingText(areaAt('subjects'))).toBe('Checking access to Subjects');
    expect(notBuiltText(areaAt('flow'))).toBe(
      'Sign-in flow is not in this build of the console yet.',
    );
    expect(tenantNotFoundText('ghost')).toBe('No tenant is named ghost.');
  });

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
