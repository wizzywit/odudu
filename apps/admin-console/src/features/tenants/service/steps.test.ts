import { describe, expect, it } from 'vitest';
import {
  administratorFailure,
  administratorLookupText,
  createTenantCall,
  findAdministratorCall,
  findTenantCall,
  stepFailureText,
  stepRefusal,
  tenantNotCreatedText,
  type StepCall,
} from '#/features/tenants/service/steps.ts';

describe('the guided administrator step', () => {
  const NETWORK = { ok: false, kind: 'network' } as const;

  const problem = (status: number, extra: object = {}) =>
    ({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Title', status, ...extra },
    }) as const;

  const call: StepCall = {
    what: 'acme was created',
    fields: ['name', 'display_name'],
    needed: 'manage-tenants',
  };

  it('names each request by what its failure says, and the capability it needs', () => {
    expect(createTenantCall('acme')).toEqual(call);
    expect(findTenantCall('acme')).toEqual({
      what: 'acme exists',
      fields: [],
      needed: 'manage-tenants',
    });
    expect(findAdministratorCall('ada')).toEqual({
      what: 'looking for ada',
      fields: [],
      needed: 'view-users',
    });
  });

  it('words each failure of a request', () => {
    expect(stepFailureText(call, NETWORK)).toBe(
      'Could not confirm that acme was created. Nothing was sent again; check before trying again.',
    );
    expect(stepFailureText(call, { ok: false, kind: 'schema' })).toBe(
      'acme was created may have happened, but the answer could not be read. Check before trying again.',
    );
    expect(stepFailureText(call, { ok: false, kind: 'defect' })).toBe(
      'The console could not finish: acme was created did not happen. This is a fault in the console, not something you did.',
    );
    expect(stepFailureText(call, problem(403))).toBe(
      'Refused: acme was created needs the manage-tenants capability.',
    );
    expect(stepFailureText(call, problem(500, { detail: 'boom' }))).toBe('boom');
    expect(stepFailureText(call, problem(500))).toBe('Title');
  });

  it('places a 400 or 409 under the fields it names', () => {
    const errors = [{ path: 'display_name', message: 'too long' }];
    expect(stepRefusal(problem(400, { errors }), call)).toEqual({
      errors: { display_name: 'too long' },
      message: null,
      unconfirmed: false,
    });
  });

  it('puts what names no field under the first, and then under none when there is no field', () => {
    const errors = [{ path: 'document.x', message: 'bad' }];
    expect(stepRefusal(problem(409, { errors }), call)).toEqual({
      errors: { name: 'document.x: bad' },
      message: null,
      unconfirmed: false,
    });
    expect(stepRefusal(problem(409, { errors }), { ...call, fields: [] })).toEqual({
      errors: {},
      message: 'document.x: bad',
      unconfirmed: false,
    });
    expect(stepRefusal(problem(400), { ...call, fields: [] })).toEqual({
      errors: {},
      message: 'Title',
      unconfirmed: false,
    });
  });

  it('leaves the field errors alone for any other failure, and asks for a look after a lost answer', () => {
    expect(stepRefusal(NETWORK, call)).toEqual({
      errors: null,
      message: stepFailureText(call, NETWORK),
      unconfirmed: true,
    });
    expect(stepRefusal(problem(403), call)).toEqual({
      errors: null,
      message: 'Refused: acme was created needs the manage-tenants capability.',
      unconfirmed: false,
    });
  });

  it('looks for the administrator after a lost create, and continues after a lost later call', () => {
    expect(administratorFailure(NETWORK, 'create', 'create', 'ada')).toEqual({
      kind: 'refused',
      call: { what: 'ada was created', fields: [], needed: 'manage-users' },
    });
    expect(administratorFailure(NETWORK, 'grant', 'set-roles', 'ada')).toEqual({
      kind: 'lost',
      message:
        'Could not confirm the last step for ada. Continuing again is safe: it repeats only what did not land.',
    });
  });

  it('places a refused create under username and email, and a refused grant under none', () => {
    expect(administratorFailure(problem(409), 'create', 'create', 'ada')).toEqual({
      kind: 'refused',
      call: { what: 'creating ada', fields: ['username', 'email'], needed: 'manage-users' },
    });
    expect(administratorFailure(problem(403), 'grant', 'clients', 'ada')).toEqual({
      kind: 'refused',
      call: { what: 'finishing ada', fields: [], needed: 'manage-clients' },
    });
    expect(
      administratorFailure({ ok: false, kind: 'defect' }, 'password', 'password', 'ada'),
    ).toEqual({
      kind: 'refused',
      call: { what: 'finishing ada', fields: [], needed: 'manage-users' },
    });
  });

  it('says what a look for the tenant or the administrator found', () => {
    expect(tenantNotCreatedText('acme')).toBe('acme was not created. Create it again.');
    expect(administratorLookupText('ada', true)).toBe('ada was created. Continue to finish.');
    expect(administratorLookupText('ada', false)).toBe(
      'ada was not created. Create the administrator again.',
    );
  });
});
