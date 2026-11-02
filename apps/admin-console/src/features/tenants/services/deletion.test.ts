import { describe, expect, it } from 'vitest';
import {
  deleteConsequence,
  deleteFailure,
  deleteState,
  DELETE_NEEDS,
  heldForTenant,
  missingIfUnknown,
  settledDeletion,
} from '#/features/tenants/services/deletion';
import type { GatewayFailure } from '#/shared/services/result';

const refused = (status: number, type = 'about:blank', extra: object = {}): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type, title: 'Title', status, ...extra },
});

describe('what the danger zone offers', () => {
  it('names the one capability the route takes', () => {
    expect(DELETE_NEEDS).toEqual(['manage-tenants']);
  });

  it('offers nothing to a caller missing the capability', () => {
    expect(deleteState({ name: 'acme', enabled: false, missing: ['manage-tenants'] })).toEqual({
      kind: 'hidden',
    });
  });

  it('says the system tenant is never deleted, whatever else is true of it', () => {
    expect(deleteState({ name: 'system', enabled: true, missing: [] })).toEqual({
      kind: 'fixed',
      text: 'system cannot be deleted: it is the tenant every cross-tenant administrator signs in to.',
    });
  });

  it('asks for the disable first while the tenant is enabled', () => {
    expect(deleteState({ name: 'acme', enabled: true, missing: [] })).toEqual({
      kind: 'disable-first',
      text: 'Disable acme first. Disabling ends its sessions and tells their relying parties, and only a disabled tenant can be deleted.',
    });
  });

  it('offers the delete for a disabled tenant', () => {
    expect(deleteState({ name: 'acme', enabled: false, missing: [] })).toEqual({ kind: 'ready' });
  });
});

describe('what a delete says it removes', () => {
  it('lists everything the cascade takes, the audit trail among it, and that it cannot be undone', () => {
    const text = deleteConsequence('acme');
    for (const part of [
      'subjects',
      'clients',
      'signing keys',
      'sessions',
      'settings',
      'audit trail',
      'cannot be undone',
      'system tenant',
    ]) {
      expect(text).toContain(part);
    }
    expect(text).toContain('acme');
  });
});

describe('when the server refuses', () => {
  it('words each typed refusal and each status', () => {
    expect(deleteFailure('acme', refused(409, 'about:blank#tenant-enabled'))).toBe(
      'acme was enabled again. Disable acme first. Disabling ends its sessions and tells their relying parties, and only a disabled tenant can be deleted.',
    );
    expect(deleteFailure('acme', refused(409, 'about:blank#sessions-live'))).toBe(
      'acme still has live sessions. Disable it again to end them and tell their relying parties, then delete it.',
    );
    expect(deleteFailure('acme', refused(409, 'about:blank#logout-deliveries-pending'))).toBe(
      'Back-Channel Logout Tokens for acme are still waiting to be sent, and deleting it would discard them. Try again once they have been sent.',
    );
    expect(deleteFailure('system', refused(409))).toBe(
      'system cannot be deleted: it is the tenant every cross-tenant administrator signs in to.',
    );
    expect(
      deleteFailure(
        'acme',
        refused(403, 'about:blank', {
          detail: 'the tenant’s subjects hold what the caller does not: manage-keys',
        }),
      ),
    ).toBe('Refused: the tenant’s subjects hold what the caller does not: manage-keys.');
  });

  it('says a lost answer was not sent again, and the console is at fault for a defect', () => {
    expect(deleteFailure('acme', { ok: false, kind: 'network' })).toContain(
      'It has not been sent again',
    );
    expect(deleteFailure('acme', { ok: false, kind: 'defect' })).toContain('was not deleted');
  });
});

describe('a tenant that is already gone', () => {
  it('counts as deleted, so its pages are left and its entries dropped', () => {
    expect(
      settledDeletion({
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Not Found', status: 404 },
      }),
    ).toMatchObject({ ok: true });
    expect(settledDeletion(refused(409)).ok).toBe(false);
    const done = { ok: true, status: 204, data: undefined, etag: null, next: null } as const;
    expect(settledDeletion(done)).toBe(done);
  });
});

describe('which cached entries belong to a tenant', () => {
  it('holds every entry keyed under its name and its own record, and no other', () => {
    expect(heldForTenant(['list', 'acme', 'subjects'], 'acme', 'record')).toBe(true);
    expect(heldForTenant(['authority', 'acme', null], 'acme', 'record')).toBe(true);
    expect(heldForTenant(['record', 'system', 'tenants/acme'], 'acme', 'record')).toBe(true);
    expect(heldForTenant(['list', 'acme-eu', 'subjects'], 'acme', 'record')).toBe(false);
    expect(heldForTenant(['record', 'system', 'tenants/acme-eu'], 'acme', 'record')).toBe(false);
    expect(heldForTenant(['list', 'system', 'tenants'], 'acme', 'record')).toBe(false);
    expect(heldForTenant(['session'], 'acme', 'record')).toBe(false);
  });
});

describe('a tenant the admin API does not know', () => {
  it('is not found as a record: its plain 401 is a 404, anything else is as it was', () => {
    const plain = refused(401);
    expect(missingIfUnknown(plain)).toMatchObject({
      ok: false,
      kind: 'problem',
      problem: { status: 404 },
    });
    const ended = refused(401, 'about:blank#console-session-ended');
    expect(missingIfUnknown(ended)).toBe(ended);
    const done = { ok: true, status: 200, data: 1, etag: null, next: null } as const;
    expect(missingIfUnknown(done)).toBe(done);
  });
});
