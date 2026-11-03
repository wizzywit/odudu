import { describe, expect, it } from 'vitest';
import { authorityOf, refusedUnknownOf } from '#/entities/session/services/whoami';
import type { Authority } from '#/shared/lib/services/principal';
import type { GatewayResult } from '#/shared/lib/services/result';

const granted: Authority = { capabilities: ['manage-users'], crossTenant: false };
const answered: GatewayResult<Authority> = {
  ok: true,
  status: 200,
  data: granted,
  etag: null,
  next: null,
};
const unknown: GatewayResult<Authority> = {
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Unauthorized', status: 401 },
};
const refused: GatewayResult<Authority> = {
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
};

describe('what whoami answered', () => {
  it('grants what it granted, and nothing before it answers or when it refuses', () => {
    expect(authorityOf(answered)).toBe(granted);
    expect(authorityOf(refused)).toBeUndefined();
    expect(authorityOf(undefined)).toBeUndefined();
  });

  it('knows a tenant is unknown only from a plain 401, and not before it answers', () => {
    expect(refusedUnknownOf(unknown)).toBe(true);
    expect(refusedUnknownOf(refused)).toBe(false);
    expect(refusedUnknownOf(answered)).toBe(false);
    expect(refusedUnknownOf(undefined)).toBeUndefined();
  });
});
