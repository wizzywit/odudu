import { expect, it } from 'vitest';
import { auditExportKey } from '#/pages/audit/repository/queryKeys';

it('keeps one audit export per tenant and per set of filters', () => {
  expect(auditExportKey('acme', 'outcome=refused')).toEqual([
    'audit-export',
    'acme',
    'outcome=refused',
  ]);
  expect(auditExportKey('acme', '')).not.toEqual(auditExportKey('acme', 'action=x'));
});
