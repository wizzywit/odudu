import { describe, expect, it } from 'vitest';
import { defaultBlock } from '#/pages/roles/services/roleDefault';
import { role } from '#/testing/roleAnswers';

const READER = role('r-read', 'reader');

describe('a role every new subject receives', () => {
  it('may be switched on only while it reaches no admin capability', () => {
    const reaching = role('r-bundle', 'bundle', null, ['view-users', 'manage-users']);
    expect(defaultBlock(READER)).toBeNull();
    expect(defaultBlock(reaching)).toBe(
      'It reaches view-users and manage-users, and a role every new subject receives may reach no admin capability. Take those composites out of it first.',
    );
    // Turning it off is never refused.
    expect(defaultBlock({ ...reaching, default_for_new_subjects: true })).toBeNull();
  });
});

const AUDITOR = role('r-aud', 'auditor');

// A tenant role nesting a capability two levels down.
const DEEP = role('r-deep', 'deep', null, ['view-audit']);

describe('the ceiling on a role, by what the server says it reaches', () => {
  it('holds a default back while the role reaches an admin capability, however deep', () => {
    expect(defaultBlock(DEEP)).toBe(
      'It reaches view-audit, and a role every new subject receives may reach no admin capability. Take those composites out of it first.',
    );
    expect(defaultBlock(AUDITOR)).toBeNull();
    expect(defaultBlock({ ...DEEP, default_for_new_subjects: true })).toBeNull();
  });
});
