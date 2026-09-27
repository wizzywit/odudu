import {
  type ListRegistrationTokensQuery,
  type MintRegistrationTokenResponse,
  type RegistrationToken,
} from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  clientRegistrationTokenRepository,
  type RegistrationTokenRecord,
} from '@odudu/domain-tenant';
import { redactedDiff } from '#/service/audit-detail';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';

const COLLECTION = 'registration-tokens';

export interface RegistrationTokenAuditEvent {
  readonly action: 'registration_token.mint' | 'registration_token.revoke';
  readonly resourceType: 'registration_token';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: RegistrationTokenAuditEvent) => Promise<void>;

export function registrationTokenWireShape(row: RegistrationTokenRecord): RegistrationToken {
  return {
    id: row.id,
    remaining_uses: row.remainingUses,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
  };
}

export type ListRegistrationTokensInput = ListRegistrationTokensQuery & {
  readonly limit: number;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
};

export type ListRegistrationTokensOutcome =
  | { kind: 'invalid_cursor' }
  | { kind: 'ok'; items: readonly RegistrationToken[]; next: string | null };

// Paged the same way `listKeys` (#/usecase/keys.ts) pages signing keys:
// `after` is a plain `gt(id, after)` in `list()`'s own SQL, so a page
// anchored on a token that has since expired, been spent out or been
// revoked still resumes from the same place — nothing here re-reads the
// anchor row itself.
export async function listRegistrationTokens(
  tx: TenantScopedDatabase,
  input: ListRegistrationTokensInput,
): Promise<ListRegistrationTokensOutcome> {
  const filters = filterDigest({});
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const rows = await clientRegistrationTokenRepository(tx).list({
    after,
    limit: input.limit + 1,
  });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.id,
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;

  return { kind: 'ok', items: page.map(registrationTokenWireShape), next };
}

export interface MintRegistrationTokenInput {
  readonly tenantId: string;
  readonly uses: number;
  readonly ttlSeconds: number;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface MintRegistrationTokenDeps {
  readonly audit: Audit;
}

/** Answers the plaintext token exactly once — nothing reads it back afterward. */
export async function mintRegistrationToken(
  tx: TenantScopedDatabase,
  deps: MintRegistrationTokenDeps,
  input: MintRegistrationTokenInput,
): Promise<MintRegistrationTokenResponse> {
  const minted = await clientRegistrationTokenRepository(tx).mint({
    tenantId: input.tenantId,
    uses: input.uses,
    ttlSeconds: input.ttlSeconds,
  });

  await deps.audit(tx, {
    action: 'registration_token.mint',
    resourceType: 'registration_token',
    resourceId: minted.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    // Named rather than diffed: the plaintext token never appears in a wire
    // shape for `redactedDiff` to read, and `ttl_seconds` names an input to
    // `mint`, not a stored column — this states the two facts worth
    // recording without ever holding the token itself.
    detail: { uses: input.uses, ttl_seconds: input.ttlSeconds },
  });

  return {
    id: minted.id,
    token: minted.token,
    remaining_uses: minted.remainingUses,
    expires_at: minted.expiresAt.toISOString(),
  };
}

export interface RevokeRegistrationTokenInput {
  readonly tokenId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface RevokeRegistrationTokenDeps {
  readonly audit: Audit;
}

export type RevokeRegistrationTokenOutcome = { kind: 'not_found' } | { kind: 'deleted' };

export async function revokeRegistrationToken(
  tx: TenantScopedDatabase,
  deps: RevokeRegistrationTokenDeps,
  input: RevokeRegistrationTokenInput,
): Promise<RevokeRegistrationTokenOutcome> {
  // `revoke()`'s own `DELETE ... RETURNING` is both the mutation and the
  // read the audit diff needs — restricted to a live row, so a token
  // already spent out or expired answers `not_found` the same way an id
  // nothing ever minted does, rather than a hollow success for a row
  // `list()` would never have shown the caller in the first place.
  const revoked = await clientRegistrationTokenRepository(tx).revoke(input.tokenId);
  if (revoked === null) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'registration_token.revoke',
    resourceType: 'registration_token',
    resourceId: input.tokenId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff('registration_token', registrationTokenWireShape(revoked), null),
  });

  return { kind: 'deleted' };
}
