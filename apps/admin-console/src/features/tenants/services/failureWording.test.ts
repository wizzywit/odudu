import { describe, expect, it } from 'vitest';
import { importMessage } from '#/features/tenants/services/import';
import { exportFailureText } from '#/features/tenants/services/export';
import { tenantChangeFailure } from '#/features/tenants/services/tenantChange';
import { stepFailureText } from '#/features/tenants/services/creationCall';
import type { GatewayFailure } from '#/shared/services/result';
import { failure, refusal } from '#/testing/failures';

describe('tenantChangeFailure', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'D400'],
    ['403', refusal(403), 'This needs the manage-tenant capability.'],
    ['404', refusal(404), 'T404'],
    ['409', refusal(409, { detail: 'D409' }), 'D409'],
    [
      '412',
      refusal(412),
      'acme changed elsewhere since you opened it. It has been read again; look at it before trying again.',
    ],
    ['413', refusal(413), 'T413'],
    ['502', refusal(502, { detail: 'D502' }), 'D502'],
    [
      'network',
      failure('network'),
      'Could not confirm the change to acme. It has not been sent again; check its status before trying again.',
    ],
    [
      'schema',
      failure('schema'),
      'The console could not make the change. This is a fault in the console, not something you did.',
    ],
    [
      'defect',
      failure('defect'),
      'The console could not make the change. This is a fault in the console, not something you did.',
    ],
    ['403 detail', refusal(403, { detail: 'D403' }), 'This needs the manage-tenant capability.'],
    ['400 title', refusal(400), 'T400'],
    ['500 title', refusal(500), 'T500'],
    ['400 too broad', refusal(400, { type: 'about:blank#audit-query-too-broad' }), 'T400'],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(tenantChangeFailure('acme', failure)).toBe(text);
  });
});

describe('stepFailureText', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'D400'],
    ['403', refusal(403), 'Refused: acme was created needs the manage-tenants capability.'],
    ['404', refusal(404), 'T404'],
    ['409', refusal(409, { detail: 'D409' }), 'D409'],
    ['412', refusal(412), 'T412'],
    ['413', refusal(413), 'T413'],
    ['502', refusal(502, { detail: 'D502' }), 'D502'],
    [
      'network',
      failure('network'),
      'Could not confirm that acme was created. Nothing was sent again; check before trying again.',
    ],
    [
      'schema',
      failure('schema'),
      'acme was created may have happened, but the answer could not be read. Check before trying again.',
    ],
    [
      'defect',
      failure('defect'),
      'The console could not finish: acme was created did not happen. This is a fault in the console, not something you did.',
    ],
    [
      '403 detail',
      refusal(403, { detail: 'D403' }),
      'Refused: acme was created needs the manage-tenants capability.',
    ],
    ['400 title', refusal(400), 'T400'],
    ['500 title', refusal(500), 'T500'],
    ['400 too broad', refusal(400, { type: 'about:blank#audit-query-too-broad' }), 'T400'],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(
      stepFailureText({ what: 'acme was created', fields: [], needed: 'manage-tenants' }, failure),
    ).toBe(text);
  });
});

describe('importMessage on a refused import', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'D400'],
    ['403', refusal(403), 'Importing a tenant needs the manage-tenants capability.'],
    ['404', refusal(404), 'T404'],
    ['409', refusal(409, { detail: 'D409' }), 'D409'],
    ['412', refusal(412), 'T412'],
    [
      '413',
      refusal(413),
      'The server, or a proxy in front of it, refused a body this large; see the deployment note on body limits.',
    ],
    ['502', refusal(502, { detail: 'D502' }), 'D502'],
    [
      'network',
      failure('network'),
      'Could not confirm the import. It was not sent again, since its client secrets are shown only once; check whether the tenant exists.',
    ],
    [
      'schema',
      failure('schema'),
      'The import could not be read back. This is a fault in the console; check whether the tenant exists.',
    ],
    [
      'defect',
      failure('defect'),
      'The import could not be read back. This is a fault in the console; check whether the tenant exists.',
    ],
    [
      '403 detail',
      refusal(403, { detail: 'D403' }),
      'Importing a tenant needs the manage-tenants capability.',
    ],
    ['400 title', refusal(400), 'T400'],
    ['500 title', refusal(500), 'T500'],
    ['400 too broad', refusal(400, { type: 'about:blank#audit-query-too-broad' }), 'T400'],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(importMessage({ ok: false, kind: 'refused', failure }, null)).toBe(text);
  });
});

describe('exportFailureText with subjects', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'D400'],
    ['403', refusal(403), 'T403'],
    ['404', refusal(404), 'T404'],
    ['409', refusal(409, { detail: 'D409' }), 'D409'],
    ['412', refusal(412), 'T412'],
    ['413', refusal(413), 'T413'],
    ['502', refusal(502, { detail: 'D502' }), 'D502'],
    ['network', failure('network'), 'The export could not be read. Nothing was saved; try again.'],
    ['schema', failure('schema'), 'The export could not be read. Nothing was saved; try again.'],
    ['defect', failure('defect'), 'The export could not be read. Nothing was saved; try again.'],
    ['403 detail', refusal(403, { detail: 'D403' }), 'D403'],
    ['400 title', refusal(400), 'T400'],
    ['500 title', refusal(500), 'T500'],
    ['400 too broad', refusal(400, { type: 'about:blank#audit-query-too-broad' }), 'T400'],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(exportFailureText(failure, true, false)).toBe(text);
  });
});

describe('exportFailureText without subjects', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'D400'],
    ['403', refusal(403), 'T403'],
    ['404', refusal(404), 'T404'],
    ['409', refusal(409, { detail: 'D409' }), 'D409'],
    ['412', refusal(412), 'T412'],
    ['413', refusal(413), 'T413'],
    ['502', refusal(502, { detail: 'D502' }), 'D502'],
    ['network', failure('network'), 'The export could not be read. Nothing was saved; try again.'],
    ['schema', failure('schema'), 'The export could not be read. Nothing was saved; try again.'],
    ['defect', failure('defect'), 'The export could not be read. Nothing was saved; try again.'],
    ['403 detail', refusal(403, { detail: 'D403' }), 'D403'],
    ['400 title', refusal(400), 'T400'],
    ['500 title', refusal(500), 'T500'],
    ['400 too broad', refusal(400, { type: 'about:blank#audit-query-too-broad' }), 'T400'],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(exportFailureText(failure, false, false)).toBe(text);
  });
});
