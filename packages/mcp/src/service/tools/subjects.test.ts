import {
  adminCapabilitiesResponseSchema,
  countResponseSchema,
  listEffectiveRolesResponseSchema,
  listSubjectsResponseSchema,
  lockoutSchema,
  setRequiredActionsResponseSchema,
  setRolesResponseSchema,
  setSubjectGroupsResponseSchema,
  subjectSchema,
  usernamePolicySchema,
} from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { subjectTools } from '#/service/tools/subjects';

function named(name: string) {
  const found = subjectTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('subjects tools', () => {
  describeReadTool({
    tool: named('list_subjects'),
    response: listSubjectsResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects',
    paged: true,
    text: ['items', 0, 'username'],
  });
  describeReadTool({
    tool: named('count_subjects'),
    response: countResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/count',
  });
  describeReadTool({
    tool: named('get_subject'),
    response: subjectSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    text: ['username'],
  });
  describeReadTool({
    tool: named('get_subject_lockout'),
    response: lockoutSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/lockout',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
  });
  describeReadTool({
    tool: named('list_subject_effective_roles'),
    response: listEffectiveRolesResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/effective-roles',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    paged: true,
  });
  describeReadTool({
    tool: named('get_subject_admin_capabilities'),
    response: adminCapabilitiesResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/admin-capabilities',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
  });
  describeReadTool({
    tool: named('get_subject_roles'),
    response: setRolesResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/roles',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
  });
  describeReadTool({
    tool: named('get_subject_groups'),
    response: setSubjectGroupsResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/groups',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    text: ['items', 0, 'name'],
  });
  describeReadTool({
    tool: named('get_subject_required_actions'),
    response: setRequiredActionsResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/required-actions',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
  });
  describeReadTool({
    tool: named('get_username_policy'),
    response: usernamePolicySchema,
    pattern: '/admin/tenants/:tenant/subjects/username-policy',
  });

  it('reads the username policy under view-users, with no argument', () => {
    const tool = named('get_username_policy');
    expect(tool.capability).toBe('view-users');
    expect(tool.access).toBe('read');
  });
});
