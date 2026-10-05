import { describe, expect, it } from 'vitest';
import { admitted, notLacking, blockedChanges, holds, lacking, readable } from '#/shared/service/access.ts';

const VIEWER = { capabilities: ['view-users'] as const, crossTenant: false };

describe('holds', () => {
  it('answers from whoami, and no until it has answered', () => {
    expect(holds(VIEWER, 'view-users')).toBe(true);
    expect(holds(VIEWER, 'manage-users')).toBe(false);
    expect(holds(undefined, 'view-users')).toBe(false);
  });
});

describe('lacking', () => {
  it('names each capability whoami says is missing, and none before it answers', () => {
    expect(lacking(VIEWER, ['view-users', 'manage-users', 'manage-clients'])).toEqual([
      'manage-users',
      'manage-clients',
    ]);
    expect(lacking(undefined, ['manage-users'])).toEqual([]);
  });
});

describe('readable', () => {
  it('reads an area needing nothing, or one whose capability is held', () => {
    expect(readable(VIEWER, null)).toBe(true);
    expect(readable(VIEWER, 'view-users')).toBe(true);
    expect(readable(VIEWER, 'manage-keys')).toBe(false);
  });

  it('keeps every area until whoami answers, since the server decides regardless', () => {
    expect(readable(undefined, 'manage-keys')).toBe(true);
  });
});

describe('blockedChanges', () => {
  const viewer = { capabilities: ['view-users', 'manage-tenant'] as const, crossTenant: false };

  it('names the changes whoami rules out, and every capability they need', () => {
    expect(
      blockedChanges(viewer, [
        { change: 'change them', needs: ['manage-tenant'] },
        { change: 'add their administrators', needs: ['manage-users', 'manage-clients'] },
        { change: 'export them', needs: ['manage-tenant', 'manage-clients'] },
      ]),
    ).toEqual({
      change: 'add their administrators or export them',
      needs: ['manage-users', 'manage-clients'],
    });
  });

  it('is nothing when every change is open, or whoami has not answered', () => {
    expect(
      blockedChanges(viewer, [{ change: 'change them', needs: ['manage-tenant'] }]),
    ).toBeNull();
    expect(
      blockedChanges(undefined, [{ change: 'change them', needs: ['manage-users'] }]),
    ).toBeNull();
  });
});

describe('admitted', () => {
  it('is true when nothing is lacking, and false before whoami has answered', () => {
    expect(admitted(VIEWER, ['view-users'])).toBe(true);
    expect(admitted(VIEWER, ['view-users', 'manage-users'])).toBe(false);
    expect(admitted(VIEWER, [])).toBe(true);
    expect(admitted(undefined, ['view-users'])).toBe(false);
  });
});

describe('notLacking', () => {
  it('is true until whoami says something is missing, including before it has answered', () => {
    expect(notLacking(VIEWER, ['view-users'])).toBe(true);
    expect(notLacking(VIEWER, ['view-users', 'manage-users'])).toBe(false);
    expect(notLacking(undefined, ['view-users'])).toBe(true);
  });
});
