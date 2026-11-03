import { isAuditInstant } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  applyBlocked,
  draftProblems,
  withUnreadable,
} from '#/pages/audit/services/draftValidation';
import { isEmptyRecord } from '#/shared/services/fieldErrors';
import { EMPTY_DRAFT } from '#/pages/audit/services/filterDraft';

const ACTOR = '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e';

describe('the form as a draft of the filters', () => {
  it('is clean when no problem is held', () => {
    expect(isEmptyRecord({})).toBe(true);
    expect(isEmptyRecord({ to: 'x' })).toBe(false);
  });

  it('is refused for a subject id that is not a UUID, with the reason beside it', () => {
    expect(draftProblems({ ...EMPTY_DRAFT, actor_subject_id: 'bob' }).actor_subject_id).toMatch(
      /UUID/u,
    );
    expect(draftProblems({ ...EMPTY_DRAFT, actor_subject_id: ACTOR })).toEqual({});
  });

  it('is refused for a text longer than the API accepts', () => {
    expect(draftProblems({ ...EMPTY_DRAFT, action: 'a'.repeat(257) }).action).toMatch(/256/u);
  });

  it('is refused for a range that ends before it starts, under the end', () => {
    const problems = draftProblems({
      ...EMPTY_DRAFT,
      from: '2026-09-28T12:00:00.000Z',
      to: '2026-09-28T11:59:59.999Z',
    });
    expect(problems.to).toMatch(/before/iu);
    expect(problems.from).toBeUndefined();
  });

  it('reads a range of dates before the trail begins as backwards, though the address would ignore them', () => {
    const before = { from: '1969-12-31T23:00:00Z', to: '1969-12-30T00:00:00Z' };
    expect(isAuditInstant(before.from)).toBe(false);
    expect(Number.isNaN(Date.parse(before.from))).toBe(false);
    expect(draftProblems({ ...EMPTY_DRAFT, ...before }).to).toMatch(/before/iu);
  });

  it('is accepted with only one end of the range', () => {
    expect(draftProblems({ ...EMPTY_DRAFT, from: '2026-09-28T12:00:00.000Z' })).toEqual({});
  });
});

describe('a date typed that no instant reads from', () => {
  it('is held against its field, and lifted when it reads', () => {
    const held = withUnreadable({}, 'from', 'That day does not exist.');
    expect(held).toEqual({ from: 'That day does not exist.' });
    expect(withUnreadable(held, 'to', 'Fill in every part.')).toEqual({
      from: 'That day does not exist.',
      to: 'Fill in every part.',
    });
    expect(withUnreadable(held, 'from', null)).toEqual({});
  });

  it('is a problem under its field, so the draft cannot be applied as if it were not there', () => {
    const problems = draftProblems(EMPTY_DRAFT, { from: 'That day does not exist.' });
    expect(problems.from).toBe('That day does not exist.');
    expect(isEmptyRecord(problems)).toBe(false);
  });

  it('blocks Apply with one line that says the trail is not narrowed by it', () => {
    expect(applyBlocked({})).toBeNull();
    expect(applyBlocked({ to: 'x' })).toMatch(/not narrowed by it/u);
  });
});
