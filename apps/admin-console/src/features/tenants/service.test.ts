import { TENANT_NAME_RULE } from '@odudu/contracts';
import { TENANT_IMPORT_BODY_LIMIT } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  enterHref,
  IMPORT_TENANT_HREF,
  NEW_TENANT_HREF,
  tenantHref,
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
  administratorOf,
  administratorStepHref,
  administratorTitle,
  belongsTo,
  flowOf,
  FRESH_CREATION,
  freshCreation,
  administratorFailure,
  administratorLookupText,
  administratorProblem,
  againOf,
  choosesHoldings,
  chosenFileOf,
  createTenantCall,
  creationHeading,
  findAdministratorCall,
  findTenantCall,
  holdsText,
  stepFailureText,
  stepRefusal,
  systemAdminsHrefOf,
  systemHoldsText,
  tenantNotCreatedText,
  unfinishedOf,
  type StepCall,
  exportFileName,
  fileChosenProblem,
  fileRequiredProblem,
  foundOf,
  importedLink,
  importedTenantOf,
  importErrors,
  importFileRefusal,
  importMessage,
  importNameError,
  importUnconfirmed,
  secretPlace,
  type ImportOutcome,
  fileSize,
  importFileProblem,
  issuerPreview,
  NAME_RULE,
  nameProblem,
  omittedOf,
  parseDocument,
} from '#/features/tenants/service.ts';

describe('the tenant name', () => {
  it("states the contract's own rule, as a sentence", () => {
    expect(NAME_RULE.toLowerCase()).toBe(`${TENANT_NAME_RULE}.`);
    expect(NAME_RULE.startsWith('A tenant name')).toBe(true);
  });

  it('asks for a name, refuses one the rule refuses, and passes a good one', () => {
    expect(nameProblem('')).toBe('Enter a name for the tenant.');
    expect(nameProblem('Acme')).toBe(NAME_RULE);
    expect(nameProblem('-acme')).toBe(NAME_RULE);
    expect(nameProblem('acme-eu')).toBeNull();
  });
});

describe('the issuer preview', () => {
  const SYSTEM = 'https://id.example/tenants/system';

  it("puts the name where the system tenant's issuer has its own", () => {
    expect(issuerPreview(SYSTEM, 'acme')).toBe('https://id.example/tenants/acme');
  });

  it('shows nothing for a name the rule refuses, or an issuer of another shape', () => {
    expect(issuerPreview(SYSTEM, '')).toBeNull();
    expect(issuerPreview(SYSTEM, 'Not A Label')).toBeNull();
    expect(issuerPreview('https://id.example/issuers/system', 'acme')).toBeNull();
    expect(issuerPreview(undefined, 'acme')).toBeNull();
  });
});

describe('the export file', () => {
  it('is named after the tenant and the day it was taken', () => {
    expect(exportFileName('acme', new Date('2026-09-29T23:59:00Z'))).toBe(
      'acme-2026-09-29.odudu-tenant.json',
    );
  });

  it('lists what the document says it left out, and nothing for a body that is not one', () => {
    expect(omittedOf('{"version":1,"omitted":["clients[0].secret","smtp.password"]}')).toEqual([
      'clients[0].secret',
      'smtp.password',
    ]);
    expect(omittedOf('{"version":1}')).toEqual([]);
    expect(omittedOf('{"omitted":[1,"a"]}')).toEqual(['a']);
    expect(omittedOf('not json')).toEqual([]);
  });

  it('reads a size in bytes as a person would', () => {
    expect(fileSize(512)).toBe('512 bytes');
    expect(fileSize(2048)).toBe('2.0 KiB');
    expect(fileSize(5 * 1024 * 1024 + 1)).toBe('5.0 MiB');
  });
});

describe('the import file', () => {
  it('refuses a file larger than the import route accepts, before it is sent', () => {
    expect(importFileProblem(TENANT_IMPORT_BODY_LIMIT)).toBeNull();
    expect(importFileProblem(TENANT_IMPORT_BODY_LIMIT + 1)).toBe(
      'The file is larger than 16.0 MiB, the most an import accepts.',
    );
  });

  it('reads a document as JSON, and says so when it is not', () => {
    expect(parseDocument('{"version":1}')).toEqual({ ok: true, document: { version: 1 } });
    expect(parseDocument('{')).toEqual({
      ok: false,
      message: 'The file is not JSON, so it cannot be a tenant document.',
    });
  });
});

describe('the addresses', () => {
  it('puts creation and import beside the list, so no tenant name shadows them', () => {
    expect(tenantHref('new')).toBe('/console/system/tenants/new');
    expect(NEW_TENANT_HREF).toBe('/console/system/new-tenant');
    expect(IMPORT_TENANT_HREF).toBe('/console/system/import-tenant');
    expect(enterHref('acme')).toBe('/console/acme');
  });
});

describe('the way back to a list', () => {
  it('climbs from a page under Tenants through the System group', () => {
    expect(tenantsTrail('acme')).toEqual([
      { label: 'System' },
      { label: 'Tenants', href: '/console/system/tenants' },
      { label: 'acme' },
    ]);
  });

  it("climbs from a tenant's own administrator step through its record", () => {
    expect(tenantAdministratorTrail('acme')).toEqual([
      { label: 'System' },
      { label: 'Tenants', href: '/console/system/tenants' },
      { label: 'acme', href: '/console/system/tenants/acme' },
      { label: 'Add an administrator' },
    ]);
  });

  it('climbs from a page under System administrators', () => {
    expect(systemAdminsTrail('Add a system administrator')).toEqual([
      { label: 'System' },
      { label: 'System administrators', href: '/console/system/system-admins' },
      { label: 'Add a system administrator' },
    ]);
  });
});

describe('the three guided flows', () => {
  it("keeps system's own administrators, and each tenant's, apart from tenant creation", () => {
    expect(flowOf('system')).toBe('system-administrator');
    expect(flowOf('acme')).toBe('administrator/acme');
    expect(flowOf('globex')).not.toBe(flowOf('acme'));
  });

  it('starts each at its own first step', () => {
    expect(freshCreation('tenant')).toEqual({ step: 'tenant', name: '', displayName: '' });
    expect(freshCreation('system-administrator')).toMatchObject({
      step: 'administrator',
      tenant: 'system',
      subjectId: null,
    });
    expect(freshCreation('administrator/acme')).toMatchObject({
      step: 'administrator',
      tenant: 'acme',
      origin: 'existing',
      subjectId: null,
    });
  });

  it('holds each flow to its own progress only', () => {
    const acme = administratorOf('acme', 'existing');
    expect(belongsTo('administrator/acme', acme)).toBe(true);
    expect(belongsTo('administrator/globex', acme)).toBe(false);
    expect(belongsTo('tenant', acme)).toBe(false);
    expect(belongsTo('tenant', administratorOf('acme', 'created'))).toBe(true);
    expect(belongsTo('administrator/acme', FRESH_CREATION)).toBe(false);
    expect(belongsTo('system-administrator', administratorOf('system', 'existing'))).toBe(true);
    expect(belongsTo('system-administrator', administratorOf('acme', 'existing'))).toBe(false);
    expect(belongsTo('tenant', { step: 'done', tenant: 'system', username: 'ada' })).toBe(false);
  });

  it('titles a first administrator apart from another one', () => {
    expect(administratorTitle('acme', 'created')).toBe('First administrator of acme');
    expect(administratorTitle('acme', 'imported')).toBe('First administrator of acme');
    expect(administratorTitle('acme', 'existing')).toBe('Add an administrator to acme');
  });

  it("puts each tenant's administrator step under its record", () => {
    expect(administratorStepHref('acme')).toBe('/console/system/tenants/acme/new-administrator');
    expect(administratorStepHref('system')).toBe('/console/system/system-admins/new');
  });
});

describe('the import page', () => {
  const TENANT = { name: 'acme' } as never;
  const created: ImportOutcome = { ok: true, tenant: TENANT, secrets: 3 };
  const refusedWith = (failure: Extract<ImportOutcome, { kind: 'refused' }>['failure']) =>
    ({ ok: false, kind: 'refused', failure }) as const;
  const problem = (status: number, extra: object = {}) =>
    refusedWith({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Title', status, ...extra },
    });

  it('says what a look for the tenant found', () => {
    expect(foundOf(null, 'acme')).toEqual({ missing: 'acme' });
    expect(foundOf({ name: 'acme' }, 'ignored')).toEqual({ tenant: 'acme' });
  });

  it('shows a chosen file by name and size, or none', () => {
    expect(chosenFileOf(null)).toBeNull();
    expect(chosenFileOf({ name: 'a.json', size: 2048 })).toEqual({
      name: 'a.json',
      size: '2.0 KiB',
    });
  });

  it('judges a chosen file by its size, and asks for one on submit', () => {
    expect(fileChosenProblem(null)).toBeNull();
    expect(fileChosenProblem({ size: 10 })).toBeNull();
    expect(fileChosenProblem({ size: TENANT_IMPORT_BODY_LIMIT + 1 })).toMatch(/larger than/);
    expect(fileRequiredProblem(null)).toBe('Choose a tenant document to import.');
    expect(fileRequiredProblem({ size: 10 })).toBeNull();
    expect(fileRequiredProblem({ size: TENANT_IMPORT_BODY_LIMIT + 1 })).toMatch(/larger than/);
  });

  it('names the tenant that exists, from the import or from a look afterwards', () => {
    expect(importedTenantOf(created, null)).toBe('acme');
    expect(importedTenantOf(null, { tenant: 'globex' })).toBe('globex');
    expect(importedTenantOf(null, { missing: 'globex' })).toBeNull();
    expect(importedTenantOf(problem(409), null)).toBeNull();
  });

  it('reads a 400 for its errors and a name problem, and a 409 for the name taken', () => {
    const errors = [
      { path: 'name', message: 'bad name' },
      { path: 'document.x', message: 'bad x' },
    ];
    expect(importErrors(problem(400, { errors }))).toEqual(errors);
    expect(importNameError(problem(400, { errors }))).toBe('bad name');
    expect(importErrors(problem(409))).toEqual([]);
    expect(importNameError(problem(409, { detail: 'acme is taken' }))).toBe('acme is taken');
    expect(importNameError(problem(409))).toBe('Title');
    expect(importNameError(problem(400))).toBeUndefined();
    expect(importErrors(null)).toEqual([]);
    expect(importNameError(created)).toBeUndefined();
  });

  it('reports a file that is not JSON beside the file, and no message', () => {
    const file: ImportOutcome = { ok: false, kind: 'file', message: 'not JSON' };
    expect(importFileRefusal(file)).toBe('not JSON');
    expect(importFileRefusal(created)).toBeUndefined();
    expect(importMessage(file, null)).toBeNull();
  });

  it('words each way an import can be refused', () => {
    expect(importMessage(null, null)).toBeNull();
    expect(importMessage(created, null)).toBeNull();
    expect(importMessage(refusedWith({ ok: false, kind: 'network' }), null)).toMatch(
      /^Could not confirm the import\. It was not sent again/,
    );
    for (const kind of ['schema', 'defect'] as const) {
      expect(importMessage(refusedWith({ ok: false, kind }), null)).toBe(
        'The import could not be read back. This is a fault in the console; check whether the tenant exists.',
      );
    }
    expect(importMessage(problem(403), null)).toBe(
      'Importing a tenant needs the manage-tenants capability.',
    );
    expect(importMessage(problem(413), null)).toMatch(/^The server, or a proxy in front of it/);
    expect(importMessage(problem(409, { detail: 'taken' }), null)).toBe('taken');
    expect(importMessage(problem(400), null)).toBe('Title');
    expect(importMessage(problem(500, { detail: 'boom' }), null)).toBe('boom');
  });

  it('says a look found nothing, and nothing once the tenant exists', () => {
    const lost = refusedWith({ ok: false, kind: 'network' });
    expect(importMessage(lost, { missing: 'acme' })).toBe(
      'acme was not imported. Import it again.',
    );
    expect(importMessage(lost, { tenant: 'acme' })).toBeNull();
    expect(importUnconfirmed(lost, null)).toBe(true);
    expect(importUnconfirmed(lost, { missing: 'acme' })).toBe(true);
    expect(importUnconfirmed(lost, { tenant: 'acme' })).toBe(false);
    expect(importUnconfirmed(problem(409), null)).toBe(false);
    expect(importUnconfirmed(null, null)).toBe(false);
  });

  it('counts the client secret being shown, and links on once none is left', () => {
    expect(secretPlace(created, 0)).toBe('1 of 3');
    expect(secretPlace(created, 2)).toBe('3 of 3');
    expect(secretPlace(null, 0)).toBe('');
    expect(secretPlace(problem(409), 0)).toBe('');
    expect(importedLink('acme', false)).toEqual({
      tenant: 'acme',
      recordHref: '/console/system/tenants/acme',
    });
    expect(importedLink('acme', true)).toBeNull();
    expect(importedLink(null, false)).toBeNull();
  });
});

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

  it('offers the choice of holdings only to a further administrator not yet given them', () => {
    expect(choosesHoldings({ origin: 'existing', granted: false })).toBe(true);
    expect(choosesHoldings({ origin: 'existing', granted: true })).toBe(false);
    expect(choosesHoldings({ origin: 'created', granted: false })).toBe(false);
    expect(choosesHoldings({ origin: 'imported', granted: false })).toBe(false);
  });

  it('asks for a username before holdings, and each under its own field', () => {
    expect(administratorProblem({ username: '', holdings: [] })).toEqual({
      username: 'Enter a username for the administrator.',
    });
    expect(administratorProblem({ username: ' ', holdings: ['tenant-admin'] })).toEqual({
      username: 'Enter a username for the administrator.',
    });
    expect(administratorProblem({ username: 'ada', holdings: [] })).toEqual({
      holdings: 'Choose Full, or at least one capability.',
    });
    expect(administratorProblem({ username: 'ada', holdings: ['view-audit'] })).toBeNull();
  });

  it('drops a creation only when a subject was already made', () => {
    expect(unfinishedOf(FRESH_CREATION)).toBeNull();
    expect(unfinishedOf(administratorOf('acme', 'existing'))).toBeNull();
    expect(
      unfinishedOf({
        step: 'administrator',
        tenant: 'acme',
        origin: 'existing',
        username: 'ada',
        email: '',
        subjectId: 's1',
        granted: true,
        holdings: ['tenant-admin'],
      }),
    ).toEqual({ tenant: 'acme', username: 'ada', granted: true });
    expect(unfinishedOf({ step: 'done', tenant: 'acme', username: 'ada' })).toBeNull();
  });

  it('says what an administrator was given, tenant-admin when Full or nothing was named', () => {
    expect(holdsText(undefined)).toBe('tenant-admin');
    expect(holdsText([])).toBe('tenant-admin');
    expect(holdsText(['view-audit', 'tenant-admin'])).toBe('tenant-admin');
    expect(holdsText(['view-audit'])).toBe('view-audit');
    expect(holdsText(['view-audit', 'view-users'])).toBe('view-audit and view-users');
    expect(holdsText(['view-audit', 'view-users', 'manage-users'])).toBe(
      'view-audit, view-users and manage-users',
    );
  });

  it('words what a system administrator holds, Full or a part of it', () => {
    expect(systemHoldsText('tenant-admin')).toBe(
      'is a system administrator, holding tenant-admin in',
    );
    expect(systemHoldsText('view-audit')).toBe('holds view-audit in');
  });

  it('starts over to a tenant from a tenant, and to an administrator from any other flow', () => {
    expect(againOf('tenant')).toBe('tenant');
    expect(againOf('system-administrator')).toBe('administrator');
    expect(againOf('administrator/acme')).toBe('administrator');
  });

  it('names where the system administrators are managed, for system alone', () => {
    expect(systemAdminsHrefOf('system')).toBe('/console/system/system-admins');
    expect(systemAdminsHrefOf('acme')).toBeNull();
  });

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

describe('the heading of the creation page', () => {
  it('is the tenant step, first under Tenants', () => {
    expect(creationHeading('tenant', { step: 'tenant' })).toEqual({
      at: 0,
      title: 'Create a tenant',
      breadcrumb: tenantsTrail('Create a tenant'),
    });
  });

  it("is a system administrator's step under System administrators, whichever flow", () => {
    const step = {
      step: 'administrator',
      tenant: 'system',
      origin: 'existing',
      systemAdminsHref: '/x',
    } as const;
    expect(creationHeading('system-administrator', step)).toEqual({
      at: 1,
      title: 'Add a system administrator',
      breadcrumb: systemAdminsTrail('Add a system administrator'),
    });
    expect(
      creationHeading('system-administrator', {
        step: 'done',
        tenant: 'system',
        systemAdminsHref: '/x',
      }).at,
    ).toBe(2);
  });

  it('is the first administrator of a tenant just made, under Tenants', () => {
    const step = {
      step: 'administrator',
      tenant: 'acme',
      origin: 'created',
      systemAdminsHref: null,
    } as const;
    expect(creationHeading('tenant', step)).toEqual({
      at: 1,
      title: 'First administrator of acme',
      breadcrumb: tenantsTrail('First administrator of acme'),
    });
  });

  it("is another administrator of an existing tenant, under that tenant's record", () => {
    const step = {
      step: 'administrator',
      tenant: 'acme',
      origin: 'existing',
      systemAdminsHref: null,
    } as const;
    expect(creationHeading('administrator/acme', step)).toEqual({
      at: 1,
      title: 'Add an administrator to acme',
      breadcrumb: tenantAdministratorTrail('acme'),
    });
    expect(
      creationHeading('administrator/acme', {
        step: 'done',
        tenant: 'acme',
        systemAdminsHref: null,
      }),
    ).toMatchObject({ at: 2, title: 'Add an administrator to acme' });
  });
});
