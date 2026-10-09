import { describe, expect, it } from 'vitest';
import type { AdminCapability } from '#/shared/service/principal.ts';
import {
  addRefusal,
  compositesFixed,
  deletionFixed,
  defaultBlock,
  deleteBlock,
  isBuiltin,
} from '#/features/roles/service/blocks.ts';

function role(
  id: string,
  name: string,
  clientKey: string | null = null,
  reach: AdminCapability[] = [],
) {
  return {
    admin_reach: reach,
    id,
    name,
    description: null,
    client_id: clientKey === null ? null : `c-${clientKey}`,
    client_key: clientKey,
    default_for_new_subjects: false,
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

const READER = role('r-read', 'reader');

const USERS = role('r-users', 'manage-users', 'odudu-admin', ['view-users', 'manage-users']);

describe('the built-in roles', () => {
  it('are the roles of the built-in admin client, whatever their name', () => {
    expect(isBuiltin(USERS)).toBe(true);
    expect(isBuiltin(role('r-x', 'manage-users', 'portal'))).toBe(false);
  });

  it('are never deleted, never made a default and keep their composites', () => {
    expect(deleteBlock(USERS, [])).toBe(
      'manage-users is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.',
    );
    expect(defaultBlock(USERS)).toBe(
      'A capability of the built-in admin client is never handed to every new subject.',
    );
  });
});

describe('the built-in sentences', () => {
  it('say what a capability role keeps, and that it is never deleted', () => {
    expect(compositesFixed(READER)).toBeNull();
    expect(compositesFixed(USERS)).toBe(
      'manage-users is a capability of the built-in admin client: it keeps the roles it was provisioned with, and nothing is nested in it or taken out of it here.',
    );
    expect(deletionFixed(READER)).toBeNull();
    expect(deletionFixed(USERS)).toBe(
      'manage-users is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.',
    );
  });
});

describe('adding a composite', () => {
  it('names the role chosen in a refusal, and leaves other refusals to the shared wording', () => {
    expect(
      addRefusal({
        type: 'about:blank',
        status: 409,
        detail: 'would create a role composite cycle',
      }),
    ).toBe(
      'Refused: the role chosen already includes this role, so nesting it here would make a loop.',
    );
    expect(addRefusal({ type: 'about:blank', status: 500 })).toBeNull();
  });
});
