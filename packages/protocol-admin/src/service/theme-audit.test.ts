import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { draftChange } from '#/service/theme-audit';

const body = (over: object = {}) => ({
  tokens: { light: { surfacePage: '#ffffff' }, font: 'IBM Plex Sans' },
  stylesheet: '.page { color: red; }',
  templates: { 'sign-in': '<p>{{error}}</p>' },
  assets: {},
  ...over,
});
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

describe('draftChange', () => {
  it('names the parts that changed with the length and SHA-256 of each before and after, never the text', () => {
    const before = body();
    const after = body({ stylesheet: '.page { color: blue; }' });
    const detail = draftChange('tenant', before as never, after as never);
    expect(detail).toEqual({
      scope: 'tenant',
      changed: {
        stylesheet: {
          before: { bytes: 23, sha256: digest(JSON.stringify('.page { color: red; }')) },
          after: { bytes: 24, sha256: digest(JSON.stringify('.page { color: blue; }')) },
        },
      },
    });
    expect(JSON.stringify(detail)).not.toContain('color');
  });

  it('is empty of changes when only the order of the keys differs', () => {
    const reordered = {
      assets: {},
      templates: { 'sign-in': '<p>{{error}}</p>' },
      stylesheet: '.page { color: red; }',
      tokens: { font: 'IBM Plex Sans', light: { surfacePage: '#ffffff' } },
    };
    expect(draftChange('client', body() as never, reordered as never)).toEqual({
      scope: 'client',
      changed: {},
    });
  });

  it('has a null before for every part of a first draft', () => {
    const detail = draftChange('tenant', null, body() as never) as {
      changed: Record<string, { before: unknown }>;
    };
    expect(Object.keys(detail.changed).sort()).toEqual([
      'assets',
      'stylesheet',
      'templates',
      'tokens',
    ]);
    for (const part of Object.values(detail.changed)) expect(part.before).toBeNull();
  });

  it('stays small for a draft of 512 KiB', () => {
    const big = body({
      stylesheet: 'a'.repeat(128 * 1024),
      templates: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [`k${String(i)}`, 'b'.repeat(64 * 1024)]),
      ),
    });
    const detail = draftChange('tenant', body() as never, big as never);
    expect(JSON.stringify(detail).length).toBeLessThan(1_000);
  });
});
