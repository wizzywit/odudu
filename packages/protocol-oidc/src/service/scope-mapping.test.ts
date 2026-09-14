import { describe, expect, it } from 'vitest';
import { narrowByScopeMappings } from '#/service/scope-mapping';

const held = [
  { roleId: 'r1', name: 'admin', clientKey: null },
  { roleId: 'r2', name: 'reader', clientKey: 'reports-api' },
];

describe('narrowByScopeMappings', () => {
  it('withholds a role the granted scopes do not reach', () => {
    expect(narrowByScopeMappings(held, new Set(['r2']), false)).toEqual([held[1]]);
  });

  it('withholds everything when nothing is mapped', () => {
    expect(narrowByScopeMappings(held, new Set(), false)).toEqual([]);
  });

  it('passes everything through when the client has full scope', () => {
    expect(narrowByScopeMappings(held, new Set(), true)).toEqual(held);
  });
});
