import { describe, expect, it } from 'vitest';
import { standardClaimMappers, type ClaimContext } from '#/service/claims';

const subjectId = 'subject-1';

function ctx(user: ClaimContext['user']): ClaimContext {
  return { subjectId, user };
}

describe('the standard OIDC claim mappers', () => {
  it('runs only mappers whose scopes were granted', async () => {
    const registry = standardClaimMappers();

    const claims = await registry.assemble(['openid'], ctx(null));

    expect(claims).toHaveProperty('sub');
    expect(claims).not.toHaveProperty('email');
  });

  it('runs the email mapper when the email scope is granted', async () => {
    const registry = standardClaimMappers();
    const user: ClaimContext['user'] = {
      subjectId,
      realmId: 'realm-1',
      username: 'alice',
      email: 'alice@example.com',
      emailVerified: true,
    };

    expect(await registry.assemble(['openid', 'email'], ctx(user))).toHaveProperty('email');
  });

  it('rejects a duplicate mapper name rather than silently replacing it', () => {
    const registry = standardClaimMappers();

    expect(() =>
      registry.register({
        name: 'sub',
        scopes: ['openid'],
        claims: ['sub'],
        map: () => Promise.resolve({}),
      }),
    ).toThrow(/already registered/);
  });

  it('lets a later mapper add claims without dropping an earlier one', async () => {
    const registry = standardClaimMappers();
    const user: ClaimContext['user'] = {
      subjectId,
      realmId: 'realm-1',
      username: 'alice',
      email: 'alice@example.com',
      emailVerified: true,
    };

    const claims = await registry.assemble(['openid', 'profile', 'email'], ctx(user));

    expect(Object.keys(claims).sort()).toEqual(['email', 'email_verified', 'name', 'sub']);
  });

  it('omits email and email_verified when the user has no email on file', async () => {
    const registry = standardClaimMappers();
    const user: ClaimContext['user'] = {
      subjectId,
      realmId: 'realm-1',
      username: 'alice',
      email: null,
      emailVerified: false,
    };

    const claims = await registry.assemble(['openid', 'email'], ctx(user));

    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('email_verified');
  });

  it('omits every user-derived claim when there is no user row for the subject', async () => {
    const registry = standardClaimMappers();

    const claims = await registry.assemble(['openid', 'profile', 'email'], ctx(null));

    expect(claims).toEqual({ sub: subjectId });
  });

  it('advertises exactly the claim names the standard mappers can produce', () => {
    const registry = standardClaimMappers();

    expect([...registry.claimNames()].sort()).toEqual(['email', 'email_verified', 'name', 'sub']);
  });
});
