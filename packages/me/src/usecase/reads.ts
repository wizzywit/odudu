import type { UserRecord } from '@odudu/domain-identity';
import type { SubjectConsent } from '@odudu/domain-tenant';
import type { MeReads } from '#/repository/reads';
import { credentialViews, type CredentialView } from '#/service/credential-view';
import { nextCursor, startAfter } from '#/service/cursor';
import { fetchLimit, pageLimit, splitPage } from '#/service/page';
import { recoveryCodesLow } from '#/service/recovery-warning';
import { sessionView, type SessionView } from '#/service/session-view';
import type { MeCaller } from '#/usecase/admit-me';

export type { MeCaller };

export interface MeReadDeps {
  readonly reads: MeReads;
  readonly now: () => Date;
}

export interface ListQuery {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

type Listed<Item> =
  | { readonly kind: 'invalid_cursor' }
  | { readonly kind: 'ok'; readonly items: readonly Item[]; readonly next: string | null };

export type CredentialsRead =
  | { readonly kind: 'invalid_cursor' }
  | {
      readonly kind: 'ok';
      readonly items: readonly CredentialView[];
      readonly next: string | null;
      readonly recoveryCodesLeft: number;
      readonly recoveryCodesLow: boolean;
    };

export async function readProfile(
  deps: MeReadDeps,
  caller: MeCaller,
): Promise<{ kind: 'ok'; profile: UserRecord } | { kind: 'not_found' }> {
  const profile = await deps.reads.profile(caller.tenantId, caller.subjectId);
  return profile === null ? { kind: 'not_found' } : { kind: 'ok', profile };
}

export async function listCredentials(
  deps: MeReadDeps,
  caller: MeCaller,
  query: ListQuery,
): Promise<CredentialsRead> {
  const start = startAfter('credentials', query.cursor, 'uuid');
  if (start.kind === 'invalid') return { kind: 'invalid_cursor' };
  const limit = pageLimit(query.limit);
  const read = await deps.reads.credentials(caller.tenantId, caller.subjectId, {
    after: start.after,
    limit: fetchLimit(limit),
  });
  const { items, hasMore } = splitPage(read.rows, limit);
  return {
    kind: 'ok',
    items: credentialViews(items),
    next: nextCursor('credentials', hasMore, items.at(-1)?.id),
    recoveryCodesLeft: read.recoveryCodesLeft,
    recoveryCodesLow: recoveryCodesLow({
      held: read.recoveryCodesHeld,
      unspent: read.recoveryCodesLeft,
      threshold: read.recoveryCodeWarnBelow,
    }),
  };
}

export async function listSessions(
  deps: MeReadDeps,
  caller: MeCaller,
  query: ListQuery,
): Promise<Listed<SessionView>> {
  const start = startAfter('sessions', query.cursor, 'uuid');
  if (start.kind === 'invalid') return { kind: 'invalid_cursor' };
  const limit = pageLimit(query.limit);
  const rows = await deps.reads.sessions(
    caller.tenantId,
    caller.subjectId,
    caller.lifespans,
    deps.now(),
    { after: start.after, limit: fetchLimit(limit) },
  );
  const { items, hasMore } = splitPage(rows, limit);
  return {
    kind: 'ok',
    items: items.map((row) => sessionView(row, caller.sessionId)),
    next: nextCursor('sessions', hasMore, items.at(-1)?.id),
  };
}

export async function listConsents(
  deps: MeReadDeps,
  caller: MeCaller,
  query: ListQuery,
): Promise<Listed<SubjectConsent>> {
  const start = startAfter('consents', query.cursor, 'text');
  if (start.kind === 'invalid') return { kind: 'invalid_cursor' };
  const limit = pageLimit(query.limit);
  const rows = await deps.reads.consents(caller.tenantId, caller.subjectId, {
    after: start.after,
    limit: fetchLimit(limit),
  });
  const { items, hasMore } = splitPage(rows, limit);
  return { kind: 'ok', items, next: nextCursor('consents', hasMore, items.at(-1)?.clientKey) };
}
