import type { ThemePreviewInfo } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_REASONS,
  FALLBACK_FAILED,
  fallbackNotice,
  noticeLines,
  type FallbackNotice,
} from '#/features/branding/service/fallback';
import type { ThemeScope } from '#/features/branding/service/scope';

const TENANT: ThemeScope = { kind: 'tenant' };
const CLIENT: ThemeScope = { kind: 'client', id: 'c1' };

function info(changes: Partial<ThemePreviewInfo> = {}): ThemePreviewInfo {
  return {
    kind: 'sign-in',
    from: 'draft',
    shown: 'tenant',
    faults: [],
    refused: [],
    unfilled: false,
    ...changes,
  };
}

const lines = (notice: FallbackNotice | null): string[] => notice?.lines ?? [];

describe('fallbackNotice', () => {
  it('says nothing when the draft is what is shown and nothing was left out', () => {
    expect(fallbackNotice(info(), TENANT)).toBeNull();
    expect(fallbackNotice(info({ shown: 'client' }), CLIENT)).toBeNull();
  });

  it('says a published theme is shown when there is no draft', () => {
    expect(lines(fallbackNotice(info({ from: 'published' }), TENANT))).toEqual([
      'There is no saved draft, so the preview shows the published theme.',
    ]);
    expect(lines(fallbackNotice(info({ from: 'published', shown: 'client' }), CLIENT))).toEqual([
      'This client has no saved draft, so the preview shows its published theme.',
    ]);
  });

  it('says the default look is shown when the scope has nothing of its own', () => {
    expect(lines(fallbackNotice(info({ from: 'none', shown: 'default' }), TENANT))).toEqual([
      'There is no saved draft or published theme, so the preview shows Instrument’s default look.',
    ]);
  });

  it('says a client with nothing of its own shows its tenant’s theme', () => {
    expect(lines(fallbackNotice(info({ from: 'none', shown: 'tenant' }), CLIENT))).toEqual([
      'This client has no saved draft or published theme, so the preview shows the tenant’s theme.',
    ]);
  });

  it.each(Object.keys(FALLBACK_REASONS))('says why a draft was not used: %s', (code) => {
    const notice = fallbackNotice(
      info({
        shown: 'default',
        faults: [{ layer: 'tenant', code: code as ThemePreviewInfo['faults'][number]['code'] }],
      }),
      TENANT,
    );
    expect(lines(notice)[0]).toBe(
      `The draft ${FALLBACK_REASONS[code as keyof typeof FALLBACK_REASONS]}.`,
    );
  });

  it('says which layer it fell back to when a whole layer was not used', () => {
    const notice = fallbackNotice(
      info({ from: 'draft', shown: 'tenant', faults: [{ layer: 'client', code: 'image_gone' }] }),
      CLIENT,
    );
    expect(lines(notice)).toEqual([
      'The client’s draft names an image that no longer exists.',
      'The preview shows the tenant’s theme instead.',
    ]);
  });

  it('says the default look is shown instead when every layer fell', () => {
    const notice = fallbackNotice(
      info({ shown: 'default', faults: [{ layer: 'tenant', code: 'invalid_body' }] }),
      TENANT,
    );
    expect(lines(notice)).toEqual([
      'The draft could not be read.',
      'The preview shows Instrument’s default look instead.',
    ]);
  });

  it('does not say a layer was swapped when only a stylesheet was left out', () => {
    const notice = fallbackNotice(
      info({ faults: [{ layer: 'tenant', code: 'stylesheet_refused' }] }),
      TENANT,
    );
    expect(lines(notice)).toEqual([
      'The draft has a stylesheet that fails today’s checks, so it is left out.',
    ]);
  });

  it('names the layer of a published tenant theme under a client', () => {
    const notice = fallbackNotice(
      info({ shown: 'default', faults: [{ layer: 'tenant', code: 'invalid_body' }] }),
      CLIENT,
    );
    expect(lines(notice)[0]).toBe('The tenant’s published theme could not be read.');
  });

  it('says which template was refused, in which layer, and with what codes', () => {
    const notice = fallbackNotice(
      info({ refused: [{ layer: 'tenant', codes: ['missing-part', 'unknown-slot'] }] }),
      TENANT,
    );
    expect(lines(notice)).toEqual([
      'The Sign in template of the draft was refused (missing-part, unknown-slot), so this page uses the template of the layer below it, or the default one.',
    ]);
  });

  it('says a template that could not be filled shows the default page', () => {
    expect(lines(fallbackNotice(info({ unfilled: true, kind: 'consent' }), TENANT))).toEqual([
      'The Consent template could not be filled, so the default page is shown.',
    ]);
  });

  it('keeps one line for each thing, in the order a reader meets them', () => {
    const notice = fallbackNotice(
      info({
        from: 'published',
        faults: [{ layer: 'tenant', code: 'stylesheet_refused' }],
        refused: [{ layer: 'tenant', codes: ['x'] }],
        unfilled: true,
      }),
      TENANT,
    );
    expect(lines(notice)).toHaveLength(4);
    expect(lines(notice)[0]).toMatch(/no saved draft/u);
  });
});

describe('noticeLines', () => {
  const retry = () => undefined;

  it('is empty while the answer is awaited and when nothing is left out', () => {
    expect(noticeLines({ status: 'loading' }, TENANT)).toEqual([]);
    expect(noticeLines({ status: 'ready', data: info() }, TENANT)).toEqual([]);
  });

  it('is the notice of an answer that says something', () => {
    expect(noticeLines({ status: 'ready', data: info({ unfilled: true }) }, TENANT)).toHaveLength(
      1,
    );
  });

  it('says so when the answer could not be had, rather than claiming nothing', () => {
    expect(noticeLines({ status: 'failed', refused: false, retry }, TENANT)).toEqual([
      FALLBACK_FAILED,
    ]);
  });
});
