import { describe, expect, it } from 'vitest';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import {
  exportBlame,
  exportedOf,
  exportFailureText,
  exportNeeds,
  exportsSubjects,
  savedText,
  exportFileName,
} from '#/features/tenants/service/export.ts';

describe('the export file', () => {
  it('is named after the tenant and the day it was taken', () => {
    expect(exportFileName('acme', new Date('2026-09-29T23:59:00Z'))).toBe(
      'acme-2026-09-29.odudu-tenant.json',
    );
  });
});

describe('the export', () => {
  const caller = (...capabilities: AdminCapability[]): Authority => ({
    capabilities,
    crossTenant: false,
  });

  it('keeps the file name, its size and what it omitted', () => {
    expect(exportedOf('a.json', '{"omitted":["x"]}')).toEqual({
      fileName: 'a.json',
      bytes: 17,
      omitted: ['x'],
    });
    expect(exportedOf('a.json', 'é').bytes).toBe(2);
  });

  it('names what is missing for the export, and for subjects, once whoami has answered', () => {
    expect(exportNeeds(undefined)).toEqual({ needs: [], subjectsNeed: null });
    expect(exportNeeds(caller('manage-tenant'))).toEqual({
      needs: ['manage-clients'],
      subjectsNeed: 'view-users',
    });
    expect(exportNeeds(caller('manage-tenant', 'manage-clients', 'view-users'))).toEqual({
      needs: [],
      subjectsNeed: null,
    });
  });

  it('asks for subjects only when chosen and not ruled out, and blames the last capability asked', () => {
    expect(exportsSubjects(true, null)).toBe(true);
    expect(exportsSubjects(true, 'view-users')).toBe(false);
    expect(exportsSubjects(false, null)).toBe(false);
    expect(exportBlame(true)).toBe('view-users');
    expect(exportBlame(false)).toBe('manage-clients');
  });

  it('words a refused, a rejected and an unreadable export', () => {
    const rejected = {
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Title', status: 500, detail: 'detail' },
    } as const;
    expect(exportFailureText(rejected, false, true)).toBe(
      'The export needs manage-tenant and manage-clients.',
    );
    expect(exportFailureText(rejected, true, true)).toBe(
      'The export needs manage-tenant and manage-clients, and view-users with subjects.',
    );
    expect(exportFailureText(rejected, false, false)).toBe('detail');
    expect(
      exportFailureText(
        { ...rejected, problem: { ...rejected.problem, detail: undefined } },
        false,
        false,
      ),
    ).toBe('Title');
    expect(exportFailureText({ ok: false, kind: 'schema' }, false, false)).toBe(
      'The export could not be read. Nothing was saved; try again.',
    );
    expect(savedText('a.json')).toBe('Saved a.json.');
  });
});
