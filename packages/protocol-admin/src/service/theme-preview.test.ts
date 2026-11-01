import { assetPath } from '@odudu/domain-theme';
import { describe, expect, it } from 'vitest';
import { base64Length, previewInfoView, usedImages } from '#/service/theme-preview';

const IMAGE = {
  id: 'i',
  sha256: 'a'.repeat(64),
  mime: 'image/png',
  width: 64,
  height: 32,
  size: 300,
};
const PATH = assetPath('acme', IMAGE.sha256, IMAGE.mime) ?? '';

describe('usedImages', () => {
  it('weighs an image once for each place it is written', () => {
    const css = `.a{background:url(${PATH})}`.repeat(5);
    const { used, weight } = usedImages('acme', [IMAGE], [`<img src="${PATH}">`, css]);
    expect(used).toHaveLength(1);
    expect(weight).toBe(base64Length(300) * 6);
  });

  it('leaves out an image nothing names', () => {
    expect(usedImages('acme', [IMAGE], ['<p>none</p>'])).toEqual({ used: [], weight: 0 });
  });
});

describe('previewInfoView', () => {
  const none = { used: [] as ('client' | 'tenant')[], faults: [], refused: [] };

  it('is the default look when no layer was used', () => {
    expect(
      previewInfoView({ kind: 'sign-in', from: 'none', built: none, unfilled: false }),
    ).toEqual({
      kind: 'sign-in',
      from: 'none',
      shown: 'default',
      faults: [],
      refused: [],
      unfilled: false,
    });
  });

  it('shows the most specific layer used', () => {
    const info = previewInfoView({
      kind: 'consent',
      from: 'draft',
      built: { ...none, used: ['client', 'tenant'] },
      unfilled: false,
    });
    expect(info.shown).toBe('client');
  });

  it('keeps only the refusals of the page asked for, split into their codes', () => {
    const info = previewInfoView({
      kind: 'sign-in',
      from: 'draft',
      built: {
        used: ['tenant'],
        faults: [{ layer: 'client', code: 'image_gone' }],
        refused: [
          { layer: 'client', kind: 'sign-in', reason: 'missing_part,unknown_slot' },
          { layer: 'tenant', kind: 'consent', reason: 'too_large' },
        ],
      },
      unfilled: true,
    });
    expect(info.refused).toEqual([{ layer: 'client', codes: ['missing_part', 'unknown_slot'] }]);
    expect(info.faults).toEqual([{ layer: 'client', code: 'image_gone' }]);
    expect(info.unfilled).toBe(true);
  });
});
