import type {
  Consent,
  EndSessionsResponse,
  Grant,
  ListConsentsResponse,
  RevokeGrantsResponse,
  Session,
  Subject,
} from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session/index.ts';
import {
  useConsents,
  useEndAllSessions,
  useEndSession,
  useGrantList,
  useRevokeConsent,
  useRevokeGrants,
  useSessionList,
} from '#/features/subjects/repository/useSessions.ts';
import type { Read } from '#/features/subjects/repository/useSubjectRead.ts';
import { subjectName } from '#/features/subjects/service.ts';
import {
  useConfirmedChange,
  type Confirming,
} from '#/features/subjects/usecase/useConfirmedChange.ts';
import { lacking } from '#/shared/service/access.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

// Sessions and grants are read and changed with manage-sessions alone:
// there is no view-sessions.
export function useHolds(tenant: string, capability: 'manage-sessions' | 'manage-users'): boolean {
  return lacking(useAuthority(tenant), [capability]).length === 0;
}

export interface SubjectSessions {
  name: string;
  list: ResourceListState<Session>;
  end: Confirming<Session>;
  endAll: Confirming<'all'>;
}

function plural(count: number, one: string, other: string): string {
  return `${String(count)} ${count === 1 ? one : other}`;
}

export function useSubjectSessions(tenant: string, subject: Subject): SubjectSessions {
  const name = subjectName(subject);
  return {
    name,
    list: useSessionList(tenant, subject.id),
    end: useConfirmedChange({
      tenant,
      capability: 'manage-sessions',
      change: useEndSession(tenant, subject.id),
      done: () => `The session of ${name} ended.`,
    }),
    endAll: useConfirmedChange({
      tenant,
      capability: 'manage-sessions',
      change: useEndAllSessions(tenant, subject.id),
      done: (_all, data: EndSessionsResponse) =>
        `${plural(data.ended, 'session', 'sessions')} of ${name} ended.`,
    }),
  };
}

export interface SubjectConsents {
  name: string;
  canManage: boolean;
  consents: Read<ListConsentsResponse>;
  revoke: Confirming<Consent>;
}

export function useSubjectConsents(
  tenant: string,
  subject: Subject,
  canManage: boolean,
): SubjectConsents {
  const name = subjectName(subject);
  return {
    name,
    canManage,
    consents: useConsents(tenant, subject.id),
    revoke: useConfirmedChange({
      tenant,
      capability: 'manage-users',
      change: useRevokeConsent(tenant, subject.id),
      done: (consent) => `${name}'s consent to ${consent.client_key} revoked.`,
    }),
  };
}

export interface GrantClient {
  id: string;
  key: string;
}

export interface SubjectGrants {
  name: string;
  list: ResourceListState<Grant>;
  // Each client a listed grant was issued through, once: a revoke takes them all.
  clients: readonly GrantClient[];
  revoke: Confirming<GrantClient>;
}

export function useSubjectGrants(tenant: string, subject: Subject): SubjectGrants {
  const name = subjectName(subject);
  const list = useGrantList(tenant, subject.id);
  const clients = new Map(list.rows.map((grant) => [grant.client_id, grant.client_key]));
  return {
    name,
    list,
    clients: [...clients].map(([id, key]) => ({ id, key })),
    revoke: useConfirmedChange({
      tenant,
      capability: 'manage-sessions',
      change: useRevokeGrants(tenant, subject.id),
      done: (client, data: RevokeGrantsResponse) =>
        `${plural(data.revoked, 'grant', 'grants')} of ${name} through ${client.key} revoked.`,
    }),
  };
}
