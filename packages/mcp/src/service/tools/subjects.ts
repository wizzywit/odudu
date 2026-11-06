import {
  adminCapabilitiesResponseSchema,
  countResponseSchema,
  countSubjectsQuerySchema,
  listEffectiveRolesResponseSchema,
  listSubjectsResponseSchema,
  lockoutSchema,
  setRequiredActionsResponseSchema,
  setRolesResponseSchema,
  setSubjectGroupsResponseSchema,
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
  pageTool({
    name: 'list_subject_effective_roles',
    description:
      'Lists every role a subject holds, one page at a time, each with how the subject came to ' +
      'hold it: assigned directly, through a group, or nested under another role.',
    routeKey: tenantGet('/subjects/:id/effective-roles'),
    capability: 'view-users',
    shape: { id: idField('subject'), ...pageShape },
    pathParams: ['id'],
    response: listEffectiveRolesResponseSchema,
  }),
  valueTool({
    name: 'get_subject_admin_capabilities',
    description:
      'Lists the admin capabilities a subject holds, each with the roles that carry it and how ' +
      'the subject holds them. "complete" is false when more roles carry them than are listed; ' +
      'then conclude nothing from what is missing.',
    routeKey: tenantGet('/subjects/:id/admin-capabilities'),
    capability: 'view-users',
    shape: { id: idField('subject') },
    pathParams: ['id'],
    response: adminCapabilitiesResponseSchema,
  }),
  valueTool({
    name: 'get_subject_roles',
    description:
      'Lists the roles assigned to a subject directly, not those it gains through groups.',
    routeKey: tenantGet('/subjects/:id/roles'),
    capability: 'view-users',
    shape: { id: idField('subject') },
    pathParams: ['id'],
    response: setRolesResponseSchema,
  }),
  valueTool({
    name: 'get_subject_groups',
    description: 'Lists the groups a subject belongs to directly.',
    routeKey: tenantGet('/subjects/:id/groups'),
    capability: 'view-users',
    shape: { id: idField('subject') },
    pathParams: ['id'],
    response: setSubjectGroupsResponseSchema,
  }),
  valueTool({
    name: 'get_subject_required_actions',
    description:
      'Lists the actions a subject must complete at next sign-in, such as changing a password.',
    routeKey: tenantGet('/subjects/:id/required-actions'),
    capability: 'view-users',
    shape: { id: idField('subject') },
    pathParams: ['id'],
    response: setRequiredActionsResponseSchema,
  }),
];
