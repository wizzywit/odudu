import type { components, paths } from '#/index';

type ListSubjects = paths['/admin/tenants/{tenant}/subjects']['get'];

export const listSubjectsTenant: ListSubjects['parameters']['path']['tenant'] = 'acme';
export const problemStatus: components['schemas']['ProblemDetails']['status'] = 400;
