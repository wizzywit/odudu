import { type RealmScopedDatabase } from '@odudu/db';
import { authorizationCodes } from '#/schema/authorization-codes';

export interface NewAuthorizationCode {
  codeHash: string;
  realmId: string;
  clientId: string;
  subjectId: string;
  redirectUri: string;
  scope: string;
  nonce: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  authTime: Date;
  expiresAt: Date;
}

// create only: the atomic single-use consume this table exists to protect
// belongs to token redemption, which owns the row from that point on.
export function authorizationCodeRepository(tx: RealmScopedDatabase) {
  return {
    async create(input: NewAuthorizationCode): Promise<void> {
      await tx.insert(authorizationCodes).values({
        ...input,
        consumedAt: null,
        grantId: null,
      });
    },
  };
}
