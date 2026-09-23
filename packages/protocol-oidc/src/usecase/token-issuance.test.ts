// A grant added to StructuredRequest with no branch in the dispatch must
// fail typecheck rather than fall through to client_credentials. This
// asserts the helper the dispatch ends with, which is what produces that
// failure.
import { TOKEN_EXCHANGE_GRANT } from '#/service/token-exchange';
import { assertNeverGrant, parseStructure } from '#/usecase/token-issuance';
import { describe, expect, it } from 'vitest';

describe('assertNeverGrant', () => {
  it('throws when reached at runtime, which it cannot be if types hold', () => {
    const impossible = { grantType: 'not_a_grant' } as unknown as never;
    expect(() => assertNeverGrant(impossible)).toThrow('unhandled grant type');
  });
});

describe('[ODUDU-TOKEN-EXCHANGE-PARSE-01] stage 1', () => {
  it('requires subject_token and subject_token_type', () => {
    expect(() => parseStructure({ grant_type: TOKEN_EXCHANGE_GRANT })).toThrow(
      expect.objectContaining({ error: 'invalid_request' }),
    );
    expect(() =>
      parseStructure({ grant_type: TOKEN_EXCHANGE_GRANT, subject_token: 'x' }),
    ).toThrow(expect.objectContaining({ error: 'invalid_request' }));
  });

  it('requires actor_token_type when actor_token is present', () => {
    expect(() =>
      parseStructure({
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token: 'x',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        actor_token: 'y',
      }),
    ).toThrow(expect.objectContaining({ error: 'invalid_request' }));
  });

  it('collapses a repeated audience the way resource is collapsed', () => {
    const parsed = parseStructure({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: 'x',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: ['a', 'b'],
    });
    expect(parsed).toMatchObject({ audience: ['a', 'b'] });
  });
});
