import { type ClientRecord } from '@odudu/domain-realm';
import { describe, expect, it } from 'vitest';
import { evaluateClientCredentialsGrant } from '#/service/client-credentials-grant';

const confidentialClient: ClientRecord = {
  id: 'client-1',
  realmId: 'realm-1',
  clientId: 'batch-job',
  name: 'Batch job',
  enabled: true,
  type: 'confidential',
  secretHash: 'hashed:secret',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  serviceSubjectId: 'subject-1',
};

describe('evaluateClientCredentialsGrant', () => {
  it('permits a confidential client with a service subject requesting an allowed scope', () => {
    const decision = evaluateClientCredentialsGrant(confidentialClient, ['reports:read'], {
      requestedScope: 'reports:read',
    });
    expect(decision).toEqual({ ok: true, scope: ['reports:read'] });
  });

  it('refuses a public client', () => {
    const publicClient: ClientRecord = {
      ...confidentialClient,
      type: 'public',
      secretHash: null,
      serviceSubjectId: null,
    };
    const decision = evaluateClientCredentialsGrant(publicClient, ['reports:read'], {
      requestedScope: 'reports:read',
    });
    expect(decision).toEqual({ ok: false, reason: 'not_confidential' });
  });

  it('refuses a confidential client with no service subject provisioned', () => {
    const unprovisioned: ClientRecord = { ...confidentialClient, serviceSubjectId: null };
    const decision = evaluateClientCredentialsGrant(unprovisioned, ['reports:read'], {
      requestedScope: 'reports:read',
    });
    expect(decision).toEqual({ ok: false, reason: 'no_service_subject' });
  });

  it('refuses scope beyond what the client is allowed', () => {
    const decision = evaluateClientCredentialsGrant(confidentialClient, ['reports:read'], {
      requestedScope: 'admin',
    });
    expect(decision).toEqual({ ok: false, reason: 'scope_widened' });
  });

  it('reports not_confidential before scope, so a public client is never reported as scope_widened', () => {
    const publicClient: ClientRecord = {
      ...confidentialClient,
      type: 'public',
      secretHash: null,
      serviceSubjectId: null,
    };
    const decision = evaluateClientCredentialsGrant(publicClient, ['reports:read'], {
      requestedScope: 'admin',
    });
    expect(decision).toEqual({ ok: false, reason: 'not_confidential' });
  });

  it('permits an empty requested scope', () => {
    const decision = evaluateClientCredentialsGrant(confidentialClient, ['reports:read'], {
      requestedScope: '',
    });
    expect(decision).toEqual({ ok: true, scope: [] });
  });
});
