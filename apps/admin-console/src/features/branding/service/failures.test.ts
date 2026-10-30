import { describe, expect, it } from 'vitest';
import { draftMoved } from '#/features/branding/service/failures';

const problem = (status: number, type = 'about:blank') => ({
  ok: false as const,
  kind: 'problem' as const,
  problem: { type, title: 'Refused', status },
});

describe('a refusal that says the draft on show is not the draft there is', () => {
  it('is a changed tag, a draft that is gone, or a publish with no draft', () => {
    expect(draftMoved(problem(412))).toBe(true);
    expect(draftMoved(problem(404))).toBe(true);
    expect(draftMoved(problem(409, 'about:blank#theme-no-draft'))).toBe(true);
  });

  it('is not a refusal about the content, a missing right or a send that threw', () => {
    expect(draftMoved(problem(409, 'about:blank#theme-nothing-to-publish'))).toBe(false);
    expect(draftMoved(problem(403))).toBe(false);
    expect(draftMoved({ ok: false, kind: 'defect' })).toBe(false);
  });

  it('is not a success', () => {
    expect(draftMoved({ ok: true, status: 200, data: undefined, etag: null, next: null })).toBe(
      false,
    );
  });
});
