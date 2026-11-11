import type { CredentialType } from '@odudu/domain-identity';
import { describe, expect, it } from 'vitest';
import { credentialView, credentialViews } from '#/service/credential-view';

const AT = new Date('2026-01-01T00:00:00Z');
const row = (type: CredentialType) => ({
  id: 'c1',
  type,
  label: null,
  createdAt: AT,
  lastUsedAt: null,
});

describe('credentialView', () => {
  it.each(['password', 'totp', 'webauthn'] as const)('shows a %s', (type) => {
    expect(credentialView(row(type))).toEqual({
      id: 'c1',
      type,
      label: null,
      createdAt: AT,
      lastUsedAt: null,
    });
  });

  it.each(['recovery-code', 'password-history'] as const)('does not show a %s', (type) => {
    expect(credentialView(row(type))).toBeNull();
  });

  it('leaves out whatever else the row carries', () => {
    const wide = { ...row('totp'), secretData: { secret: 'x' } };
    const view = credentialView(wide);
    expect(Object.keys(view ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'label',
      'lastUsedAt',
      'type',
    ]);
  });
});

describe('credentialViews', () => {
  it('keeps the kinds a person is shown, in order', () => {
    const views = credentialViews([row('recovery-code'), row('password'), row('totp')]);
    expect(views.map((v) => v.type)).toEqual(['password', 'totp']);
  });
});
