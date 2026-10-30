import { describe, expect, it } from 'vitest';
import { MAX_ISSUE_DETAIL, safeDetail } from '#/service/theme-issues';

describe('safeDetail', () => {
  it('passes an ordinary name through', () => {
    expect(safeDetail('form.open')).toBe('form.open');
  });

  it('removes control, bidirectional and separator characters', () => {
    expect(safeDetail('a\u0000b\u001bc\u007fd‮e⁦f‎g h i﻿j')).toBe('abcdefghij');
  });

  it('drops a lone surrogate and keeps a pair whole', () => {
    expect(safeDetail('a\ud800b')).toBe('ab');
    expect(safeDetail('a\u{1f600}b')).toBe('a\u{1f600}b');
  });

  it('cuts a megabyte to the bound without splitting a pair', () => {
    const cut = safeDetail('\u{1f600}'.repeat(500_000));
    expect(Array.from(cut).length).toBeLessThanOrEqual(MAX_ISSUE_DETAIL + 1);
    expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
    expect(safeDetail('x'.repeat(1_000_000)).length).toBeLessThanOrEqual(MAX_ISSUE_DETAIL + 1);
  });

  it('leaves markup as text, never interpreted', () => {
    expect(safeDetail('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});
