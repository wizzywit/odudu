import { describe, expect, it } from 'vitest';
import {
  promoteWarning,
  promotionLabel,
  promotionReading,
  promotionText,
} from '#/features/signing-keys/services/promotion';

const NOW = new Date('2026-10-12T12:00:00Z');

describe('what a promotion reading says', () => {
  it('labels ready and not ready', () => {
    expect(promotionLabel({ kind: 'ready' })).toBe('Ready');
    expect(promotionLabel({ kind: 'young', at: NOW })).toBe('Not ready');
    expect(promotionLabel({ kind: 'unknown' })).toBe('Unknown');
  });

  it('names the time a young key is ready from', () => {
    expect(promotionText({ kind: 'young', at: new Date('2026-10-12T12:35:00Z') })).toBe(
      'Ready from 2026-10-12 12:35:00 UTC: until then a relying party may not have fetched its public key.',
    );
  });

  it('reads a key of another algorithm as a migration, not as unready', () => {
    const reading = promotionReading({ kind: 'algorithm', active: 'ES256' });
    expect(reading).toMatchObject({ ready: false, label: 'Changes algorithm', tone: 'neutral' });
    expect(reading.text).toContain('migrate');
  });

  it('names both algorithms', () => {
    expect(promotionText({ kind: 'algorithm', active: 'ES256' })).toContain('ES256');
  });

  it('warns of nothing for a ready key, and leaves the choice with the caller otherwise', () => {
    expect(promoteWarning({ kind: 'ready' })).toBeNull();
    const warning = promoteWarning({ kind: 'replaced' });
    expect(warning).toContain('older than the active key');
    expect(warning).toContain('the server does not refuse it');
  });
});

it('reads a promotion as whether it is ready, a label and a sentence', () => {
  expect(promotionReading({ kind: 'ready' })).toEqual({
    ready: true,
    tone: 'active',
    label: 'Ready',
    text: 'Ready to promote.',
  });
  expect(promotionReading({ kind: 'replaced' })).toMatchObject({
    ready: false,
    label: 'Not ready',
  });
});
