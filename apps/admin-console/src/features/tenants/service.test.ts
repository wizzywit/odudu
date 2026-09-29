import { TENANT_NAME_RULE } from '@odudu/contracts';
import { TENANT_IMPORT_BODY_LIMIT } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  enterHref,
  IMPORT_TENANT_HREF,
  NEW_TENANT_HREF,
  tenantHref,
  systemAdminsTrail,
  tenantsTrail,
  administratorOf,
  administratorStepHref,
  belongsTo,
  flowOf,
  FRESH_CREATION,
  freshCreation,
  exportFileName,
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

  it("puts each tenant's administrator step under its record", () => {
    expect(administratorStepHref('acme')).toBe('/console/system/tenants/acme/new-administrator');
    expect(administratorStepHref('system')).toBe('/console/system/system-admins/new');
  });
});
