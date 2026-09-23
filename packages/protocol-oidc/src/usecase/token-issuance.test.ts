// A grant added to StructuredRequest with no branch in the dispatch must
// fail typecheck rather than fall through to client_credentials. This
// asserts the helper the dispatch ends with, which is what produces that
// failure.
import { assertNeverGrant } from '#/usecase/token-issuance';
import { describe, expect, it } from 'vitest';

describe('assertNeverGrant', () => {
  it('throws when reached at runtime, which it cannot be if types hold', () => {
    const impossible = { grantType: 'not_a_grant' } as unknown as never;
    expect(() => assertNeverGrant(impossible)).toThrow('unhandled grant type');
  });
});
