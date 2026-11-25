import { expect, it } from 'vitest';
import { subjectLinkOf } from '#/entities/subject/services/subjectLink';

const href = (tenant: string, id: string) => `/console/${tenant}/subjects/${id}`;

it('is made for a caller who may read subjects, and is none for one who may not', () => {
  expect(subjectLinkOf(true, 'acme', href)?.('s1')).toBe('/console/acme/subjects/s1');
  expect(subjectLinkOf(false, 'acme', href)).toBeNull();
});
