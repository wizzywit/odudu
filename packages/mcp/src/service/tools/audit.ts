import {
  countAuditQuerySchema,
  countResponseSchema,
  listAuditResponseSchema,
} from '@odudu/contracts/admin';
import { pageShape, pageTool, tenantGet, valueTool } from '#/service/read-tool';

export const auditTools = [
  pageTool({
    name: 'list_audit',
    description:
      "Lists the tenant's audit events, newest first, one page at a time, filtered by event type, " +
      'actor, resource, action, outcome and time range. Event detail holds text users and agents ' +
      'chose.',
    routeKey: tenantGet('/audit'),
    capability: 'view-audit',
    shape: { ...countAuditQuerySchema.shape, ...pageShape },
    response: listAuditResponseSchema,
  }),
  valueTool({
    name: 'count_audit',
    description:
      'Counts audit events under the same filters as list_audit; "capped" is true when the real ' +
      'number is larger.',
    routeKey: tenantGet('/audit/count'),
    capability: 'view-audit',
    shape: countAuditQuerySchema.shape,
    response: countResponseSchema,
  }),
];
