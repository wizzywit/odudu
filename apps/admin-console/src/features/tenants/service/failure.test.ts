import { describe, expect, it } from 'vitest';
import { tenantChangeFailure } from '#/features/tenants/service/failure.ts';

describe('enabling and disabling a tenant', () => {
  it('words each way the change fails', () => {
    const problem = (status: number, extra: object = {}) =>
      ({
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Title', status, ...extra },
      }) as const;
    expect(tenantChangeFailure('acme', { ok: false, kind: 'network' })).toBe(
      'Could not confirm the change to acme. It has not been sent again; check its status before trying again.',
    );
    expect(tenantChangeFailure('acme', problem(412))).toBe(
      'acme changed elsewhere since you opened it. It has been read again; look at it before trying again.',
    );
    expect(tenantChangeFailure('acme', problem(403))).toBe(
      'This needs the manage-tenant capability.',
    );
    expect(tenantChangeFailure('acme', problem(409, { detail: 'detail' }))).toBe('detail');
    expect(tenantChangeFailure('acme', problem(409))).toBe('Title');
    for (const kind of ['schema', 'defect'] as const) {
      expect(tenantChangeFailure('acme', { ok: false, kind })).toBe(
        'The console could not make the change. This is a fault in the console, not something you did.',
      );
    }
  });
});
