import {
  countResponseSchema,
  countSubjectsQuerySchema,
  listSubjectsResponseSchema,
  lockoutSchema,
  subjectSchema,
} from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet, valueTool } from '#/service/read-tool';

export const subjectTools = [
  pageTool({
    name: 'list_subjects',
    description:
      "Lists the tenant's subjects (people and service accounts), one page at a time, searched by " +
      'one name, email or username prefix and filtered by role, group, capability, type or state. ' +
      'The result holds personal data.',
    routeKey: tenantGet('/subjects'),
    capability: 'view-users',
    shape: { ...countSubjectsQuerySchema.shape, ...pageShape },
    response: listSubjectsResponseSchema,
  }),
  valueTool({
    name: 'count_subjects',
    description:
      'Counts the tenant\'s subjects under the same filters as list_subjects; "capped" is true ' +
      'when the real number is larger.',
    routeKey: tenantGet('/subjects/count'),
    capability: 'view-users',
    shape: countSubjectsQuerySchema.shape,
    response: countResponseSchema,
  }),
  valueTool({
    name: 'get_subject',
    description:
      'Reads one subject: its names, email, state and kind. The result holds personal data.',
    routeKey: tenantGet('/subjects/:id'),
    capability: 'view-users',
    shape: { id: idField('subject') },
    pathParams: ['id'],
    response: subjectSchema,
  }),
  valueTool({
    name: 'get_subject_lockout',
    description: 'Says whether a subject is locked out of signing in right now.',
    routeKey: tenantGet('/subjects/:id/lockout'),
    capability: 'view-users',
    shape: { id: idField('subject') },
    pathParams: ['id'],
    response: lockoutSchema,
  }),
];
