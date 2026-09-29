import { describe, expect, it } from 'vitest';
import {
  confirmationText,
  onlyHolderOf,
  revokeConsequence,
  subjectName,
} from '#/features/system-admins/service.ts';

const ADA = {
  id: '01a0e72d-7fc7-7950-a1e7-1d079588f8b4',
  type: 'user' as const,
  username: 'ada',
  email: null,
  enabled: true,
  created_at: '2026-09-28T08:41:53.858Z',
};
const SERVICE = {
  ...ADA,
  id: '01a0e72d-7fc7-7950-a1e7-1d079588f8b5',
  type: 'service' as const,
  username: null,
};

describe('a holder', () => {
  it('is named by username, or by id when it has none', () => {
    expect(subjectName(ADA)).toBe('ada');
    expect(subjectName(SERVICE)).toBe(SERVICE.id);
    expect(confirmationText(ADA)).toBe('ada');
    expect(confirmationText(SERVICE)).toBe(SERVICE.id);
  });
});

describe('the only holder', () => {
  it('is the enabled row when exactly one enabled subject holds manage-tenants', () => {
    const disabled = { ...ADA, id: 'x', enabled: false };
    expect(onlyHolderOf([disabled, ADA], { count: 1, capped: false })).toBe(ADA);
  });

  it('is nobody while the count is unknown, capped or more than one', () => {
    expect(onlyHolderOf([ADA], null)).toBeNull();
    expect(onlyHolderOf([ADA], { count: 2, capped: false })).toBeNull();
    expect(onlyHolderOf([ADA], { count: 1, capped: true })).toBeNull();
    expect(onlyHolderOf([{ ...ADA, enabled: false }], { count: 1, capped: false })).toBeNull();
  });
});

describe('what revoking says', () => {
  it('names what is taken from somebody else, and what is kept', () => {
    expect(revokeConsequence(ADA, false)).toMatch(/^ada loses tenant-admin and manage-tenants/u);
    expect(revokeConsequence(ADA, false)).toMatch(/other roles are kept/u);
  });

  it('says so when it is your own', () => {
    expect(revokeConsequence(ADA, true)).toMatch(/^You are revoking your own/u);
    expect(revokeConsequence(ADA, true)).toMatch(/System area/u);
  });
});
