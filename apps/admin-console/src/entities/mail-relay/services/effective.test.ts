import { describe, expect, it } from 'vitest';
import {
  effectiveLabel,
  effectiveReading,
  effectiveTone,
  hasRelay,
} from '#/entities/mail-relay/services/effective';
import type { SmtpConfig } from '#/entities/mail-relay/types/mailRelay';

describe('effectiveReading', () => {
  it('says whose relay the tenant’s mail goes through', () => {
    expect(effectiveReading('tenant')).toMatch(/its own relay/u);
    expect(effectiveReading('deployment')).toMatch(/deployment’s sender/u);
    expect(effectiveReading('none')).toMatch(/only written to the server’s log/u);
  });
});

describe('effectiveTone', () => {
  it('warns only when no mail is sent at all', () => {
    expect(effectiveTone('tenant')).toBe('active');
    expect(effectiveTone('deployment')).toBe('neutral');
    expect(effectiveTone('none')).toBe('warning');
  });
});

describe('effectiveLabel', () => {
  it('names each source in a word or two', () => {
    expect(effectiveLabel('tenant')).toBe('own relay');
    expect(effectiveLabel('deployment')).toBe('deployment sender');
    expect(effectiveLabel('none')).toBe('not sent');
  });
});

describe('hasRelay', () => {
  const config = (effective: SmtpConfig['effective']): SmtpConfig => ({
    configured: effective === 'tenant',
    host: null,
    port: null,
    from_address: null,
    username: null,
    password_set: false,
    starttls: null,
    effective,
  });

  it('is true for the tenant’s own relay and for the deployment’s, false for none', () => {
    expect(hasRelay(config('tenant'))).toBe(true);
    expect(hasRelay(config('deployment'))).toBe(true);
    expect(hasRelay(config('none'))).toBe(false);
  });
});
