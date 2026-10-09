import { TENANT_IMPORT_BODY_LIMIT } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  chosenFileOf,
  fileChosenProblem,
  fileRequiredProblem,
} from '#/features/tenants/service/document.ts';
import {
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
} from '#/features/tenants/service/import.ts';

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
