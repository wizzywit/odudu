import { describe, expect, it } from 'vitest';
import { holds, lacking, readable } from '#/shared/service/access.ts';

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
