import {
  type ListRegistrationTokensQuery,
  type MintRegistrationTokenResponse,
  type RegistrationToken,
} from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  clientRegistrationTokenRepository,
  clientRegistrationTokens,
  type RegistrationTokenRecord,
} from '@odudu/domain-tenant';
import { eq } from 'drizzle-orm';
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

// `list()` (@odudu/domain-tenant) already excludes a spent or expired token
// and answers no more than a tenant's own handful of live ones, so this
// pages the array it returns rather than adding a second, SQL-side cursor
// query — the same trade `filterDigest`'s empty filter set signals with no
// search field to bind into it.
export async function listRegistrationTokens(
  tx: TenantScopedDatabase,
  input: ListRegistrationTokensInput,
): Promise<ListRegistrationTokensOutcome> {
  const filters = filterDigest({});
  let afterId: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    afterId = decoded.after;
  }

  const all = await clientRegistrationTokenRepository(tx).list();
  let startIndex = 0;
  if (afterId !== undefined) {
    const index = all.findIndex((row) => row.id === afterId);
    startIndex = index === -1 ? all.length : index + 1;
  }

  const rest = all.slice(startIndex);
  const hasMore = rest.length > input.limit;
  const page = hasMore ? rest.slice(0, input.limit) : rest;
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

async function currentRegistrationToken(
  tx: TenantScopedDatabase,
  id: string,
): Promise<RegistrationTokenRecord | null> {
  const rows = await tx
    .select({
      id: clientRegistrationTokens.id,
      remainingUses: clientRegistrationTokens.remainingUses,
      createdAt: clientRegistrationTokens.createdAt,
      expiresAt: clientRegistrationTokens.expiresAt,
    })
    .from(clientRegistrationTokens)
    .where(eq(clientRegistrationTokens.id, id));
  return rows[0] ?? null;
}

export async function revokeRegistrationToken(
  tx: TenantScopedDatabase,
  deps: RevokeRegistrationTokenDeps,
  input: RevokeRegistrationTokenInput,
): Promise<RevokeRegistrationTokenOutcome> {
  const before = await currentRegistrationToken(tx, input.tokenId);
  const revoked = await clientRegistrationTokenRepository(tx).revoke(input.tokenId);
  if (!revoked) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'registration_token.revoke',
    resourceType: 'registration_token',
    resourceId: input.tokenId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff(
      'registration_token',
      before === null ? null : registrationTokenWireShape(before),
      null,
    ),
  });

  return { kind: 'deleted' };
}
