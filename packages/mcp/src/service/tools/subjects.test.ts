import {
  countResponseSchema,
  listSubjectsResponseSchema,
  lockoutSchema,
  subjectSchema,
} from '@odudu/contracts/admin';
import { describe } from 'vitest';
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
});
