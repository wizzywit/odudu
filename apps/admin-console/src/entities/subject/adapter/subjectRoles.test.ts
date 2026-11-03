import { expect, it } from 'vitest';
import roles from '#/entities/subject/adapter/fixtures/roles.json';
import { readSubjectRoles, setSubjectRoles } from '#/entities/subject/adapter/subjectRoles';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const ID = '01a0ea54-2519-7513-8bf7-c105e0cfd9dd';

it("reads a subject's roles with their ETag and replaces them under If-Match", async () => {
  const fake = fakeTransport({
    [`GET ${ACME_ADMIN}/subjects/${ID}/roles`]: json(roles, 200, { etag: '"r1"' }),
    [`PUT ${ACME_ADMIN}/subjects/${ID}/roles`]: json(roles, 200, { etag: '"r2"' }),
  });
  const gateway = fake.transport.gateway;
  expect(await readSubjectRoles(gateway, 'acme', ID)).toMatchObject({
    ok: true,
    etag: '"r1"',
    data: roles,
  });
  await setSubjectRoles(gateway, 'acme', ID, ['r1', 'r2'], '"r1"');
  expect(fake.sent[1]).toMatchObject({ ifMatch: '"r1"', body: { role_ids: ['r1', 'r2'] } });
});
