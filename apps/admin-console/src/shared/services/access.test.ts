import { describe, expect, it } from 'vitest';
import {
  blockedChanges,
  callerCapabilities,
  ceilingCaller,
  holds,
  lacking,
  notLacking,
  readable,
  offersWrites,
} from '#/shared/services/access';

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

describe('notLacking', () => {
  it('is true until whoami says something is missing, including before it has answered', () => {
    expect(notLacking(VIEWER, ['view-users'])).toBe(true);
    expect(notLacking(VIEWER, ['view-users', 'manage-users'])).toBe(false);
    expect(notLacking(undefined, ['view-users'])).toBe(true);
  });
});

describe('callerCapabilities', () => {
  it('lists what whoami says is held, and nothing until it has answered', () => {
    expect(callerCapabilities(VIEWER)).toEqual(['view-users']);
    expect(callerCapabilities(undefined)).toEqual([]);
  });
});

describe('ceilingCaller', () => {
  it('gives the caller a ready ceiling read, and nothing before it is', () => {
    expect(ceilingCaller({ status: 'ready', caller: ['manage-users'] })).toEqual(['manage-users']);
    expect(ceilingCaller({ status: 'checking' })).toEqual([]);
    expect(ceilingCaller({ status: 'failed' })).toEqual([]);
  });
});

describe('readable, as the evaluate, sessions and roles gates use it', () => {
  const sessions = { capabilities: ['manage-sessions'], crossTenant: false } as const;
  const clients = { capabilities: ['manage-clients'], crossTenant: false } as const;

  it('admits the capability, rules nobody out before whoami answers, and rules out the rest', () => {
    expect(readable(VIEWER, 'view-users')).toBe(true);
    expect(readable(clients, 'view-users')).toBe(false);
    expect(readable(sessions, 'manage-sessions')).toBe(true);
    expect(readable(clients, 'manage-sessions')).toBe(false);
    expect(readable(undefined, 'view-users')).toBe(true);
    expect(readable(undefined, 'manage-sessions')).toBe(true);
  });
});

describe('offersWrites', () => {
  const manager = { capabilities: ['manage-users' as const], crossTenant: false };
  const viewer = { capabilities: ['view-users' as const], crossTenant: false };

  it('is allowed unless the page ruled it out or whoami says manage-users is missing', () => {
    expect(offersWrites(true, manager)).toBe(true);
    expect(offersWrites(true, undefined)).toBe(true);
    expect(offersWrites(true, viewer)).toBe(false);
    expect(offersWrites(false, manager)).toBe(false);
  });
});
