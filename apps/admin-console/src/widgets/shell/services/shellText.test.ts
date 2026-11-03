import { describe, expect, it } from 'vitest';
import { areaAt } from '#/entities/area';
import {
  areasLabel,
  brandText,
  checkingText,
  signedInFrom,
  SYSTEM_KICKER,
  systemCheckingText,
  tenantNotFoundText,
} from '#/widgets/shell/services/shellText';

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
    expect(tenantNotFoundText('ghost')).toBe('No tenant is named ghost.');
  });

  it('names the page a system gate checks access to', () => {
    expect(SYSTEM_KICKER).toBe('System');
    expect(systemCheckingText('Tenants')).toBe('Checking access to Tenants');
  });
});
