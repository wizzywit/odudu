import { TENANT_IMPORT_BODY_LIMIT } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  fileSize,
  importFileProblem,
  omittedOf,
  parseDocument,
} from '#/features/tenants/service/document.ts';

describe('the export file', () => {
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
