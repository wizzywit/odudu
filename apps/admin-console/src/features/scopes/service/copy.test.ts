import { describe, expect, it } from 'vitest';
import {
  type CopyRead,
  sourceDescription,
  copyBody,
  createBodyOf,
  copyHrefOf,
  copyingOf,
  copyingText,
  copyPlan,
  asksPart,
  copySourceOf,
  partMissed,
  partialCopy,
  sourceBound,
  sourceRoles,
} from '#/features/scopes/service/copy';
import { role } from '#/testing/roleAnswers';

const AUDITOR = role('r1', 'auditor');
const KEEPER = role('r2', 'keeper', null, ['manage-keys']);

const SCOPE = {
  id: 's1',
  name: 'billing',
  description: 'Invoices',
  include_in_id_token: true,
  include_in_access_token: false,
  default_client_assignment: 'optional' as const,
  consent_text: 'Read invoices',
  description_i18n: {},
  consent_text_i18n: {},
  display_order: 4,
  created_at: '2026-09-28T08:41:53.858Z',
};

describe('copying a scope', () => {
  it('maps each role the caller could give, and says why it leaves the rest', () => {
    const plan = copyPlan([AUDITOR, KEEPER], ['view-users'], 'acme');
    expect(plan.mapped).toEqual([AUDITOR]);
    expect(plan.left).toEqual([
      {
        name: 'keeper',
        why: 'It reaches manage-keys, which you do not hold, so you cannot give or take it.',
      },
    ]);
  });

  it('maps everything until the caller is known', () => {
    expect(copyPlan([AUDITOR, KEEPER], undefined, 'acme')).toEqual({
      mapped: [AUDITOR, KEEPER],
      left: [],
    });
  });

  it('copies the scope as it is set, but for its name, and not the clients', () => {
    expect(copyBody(SCOPE, 'Edited')).toEqual({
      description: 'Edited',
      include_in_id_token: true,
      include_in_access_token: false,
      default_client_assignment: 'optional',
      consent_text: 'Read invoices',
      display_order: 4,
    });
    expect(copyBody({ ...SCOPE, description: null, consent_text: null }, '')).toEqual({
      description: '',
      include_in_id_token: true,
      include_in_access_token: false,
      default_client_assignment: 'optional',
      display_order: 4,
    });
  });

  it('carries the translations of the description and the consent text', () => {
    const translated = {
      ...SCOPE,
      description_i18n: { fr: 'Factures' },
      consent_text_i18n: { fr: 'Lire les factures', de: 'Rechnungen lesen' },
    };
    expect(copyBody(translated, 'Edited')).toMatchObject({
      description: 'Edited',
      description_i18n: { fr: 'Factures' },
      consent_text_i18n: { fr: 'Lire les factures', de: 'Rechnungen lesen' },
    });
  });

  it('leaves a map nobody filled out of the copy', () => {
    expect(copyBody(SCOPE, 'd')).not.toHaveProperty('description_i18n');
    expect(copyBody(SCOPE, 'd')).not.toHaveProperty('consent_text_i18n');
  });

  it('sends a plain scope as its name and description, a copy as the source with them', () => {
    expect(createBodyOf('n', 'd', { status: 'none' })).toEqual({ name: 'n', description: 'd' });
    const source: CopyRead = { status: 'ready', scope: SCOPE, roles: [], bound: [] };
    expect(createBodyOf('n', 'd', source)).toMatchObject({
      name: 'n',
      description: 'd',
      display_order: 4,
    });
  });

  it("reads the source's description, none until it is ready", () => {
    const source: CopyRead = { status: 'ready', scope: SCOPE, roles: [], bound: [] };
    expect(sourceDescription(source)).toBe('Invoices');
    expect(sourceDescription({ status: 'none' })).toBeNull();
  });

  it('says what the copy will carry', () => {
    const source: CopyRead = {
      status: 'ready',
      scope: SCOPE,
      roles: [AUDITOR, KEEPER],
      bound: ['email', 'groups'],
    };
    const copying = copyingOf(source, copyPlan([AUDITOR, KEEPER], ['view-users'], 'acme'));
    expect(copying).toMatchObject({ status: 'ready', name: 'billing', roles: ['auditor'] });
    expect(copyingText(copying as Extract<typeof copying, { status: 'ready' }>)).toBe(
      'A copy of billing, mapping auditor and binding email and groups.',
    );
    expect(copyingOf({ status: 'loading' }, { mapped: [], left: [] })).toEqual({
      status: 'loading',
    });
  });

  it('says what a copy could not take, and where to set it', () => {
    expect(partialCopy('acme', { id: 'n1', name: 'billing-2' }, [])).toBeNull();
    expect(partialCopy('acme', { id: 'n1', name: 'billing-2' }, ['roles', 'mappers'])).toEqual({
      text: 'billing-2 was created, but its roles and claim mappers could not be copied. Set them from its Roles and Claim mappers tabs.',
      href: '/console/acme/scopes/n1',
      name: 'billing-2',
    });
  });

  it('offers a copy from the scope, never for another tenant', () => {
    expect(copyHrefOf('acme', 's1')).toBe('/console/acme/scopes/new?copy=s1');
  });
});

describe('what a copy is read as', () => {
  const ok = <T>(data: T) => ({ ok: true as const, status: 200, data, etag: null, next: null });
  const failed = { ok: false as const, kind: 'network' as const };
  const source = { scope: SCOPE, roles: [AUDITOR], bound: ['email'] };

  it('keeps the scope, its mapped roles and its bound mappers when all three were read', () => {
    expect(copySourceOf(ok(SCOPE), ok({ items: [AUDITOR] }), ok({ bound: ['email'] }))).toEqual(
      source,
    );
  });
  it('is nothing when any of the three could not be read', () => {
    expect(copySourceOf(failed, ok({ items: [] }), ok({ bound: [] }))).toBeNull();
    expect(copySourceOf(ok(SCOPE), failed, ok({ bound: [] }))).toBeNull();
    expect(copySourceOf(ok(SCOPE), ok({ items: [] }), failed)).toBeNull();
  });
});

describe('the roles and mappers of the source a copy is made of', () => {
  const ready: CopyRead = { status: 'ready', scope: SCOPE, roles: [AUDITOR], bound: ['email'] };

  it('are those of a scope read, and none until then', () => {
    expect(sourceRoles(ready)).toEqual([AUDITOR]);
    expect(sourceBound(ready)).toEqual(['email']);
    expect(sourceRoles({ status: 'loading' })).toEqual([]);
    expect(sourceBound({ status: 'failed' })).toEqual([]);
    expect(sourceBound({ status: 'none' })).toEqual([]);
  });
});

describe('a part of a copy', () => {
  it('is asked for only when there is something to put in it', () => {
    expect(asksPart(['a'])).toBe(true);
    expect(asksPart([])).toBe(false);
  });
  it('is missed unless its write was made and took', () => {
    const ok = { ok: true as const };
    expect(partMissed('roles', ok)).toEqual([]);
    expect(partMissed('roles', { ok: false })).toEqual(['roles']);
    expect(partMissed('mappers', null)).toEqual(['mappers']);
  });
});
