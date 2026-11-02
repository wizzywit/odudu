import { describe, expect, it } from 'vitest';
import {
  effectiveLabel,
  effectiveReading,
  effectiveTone,
} from '#/features/email/services/effective';

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
