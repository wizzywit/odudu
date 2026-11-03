import type { AdminCapability } from '#/shared/services/principal';
import { useAuthority } from '#/entities/session';
import {
  useConsentList,
  useEndAllSessions,
  useEndSession,
  useGrantList,
  useRevokeConsent,
  useRevokeGrants,
  useSessionList,
} from '#/pages/subjects/repository/useSessions';
import {
  consentRevokedText,
  grantClients,
  grantsRevokedText,
  sessionEndedText,
  sessionsEndedText,
  type GrantClient,
} from '#/pages/subjects/services/sessions';
import { useConfirmedSubjectChange } from '#/pages/subjects/use-cases/useConfirmedSubjectChange';
import { notLacking } from '#/shared/services/access';
import type { ResourceListState } from '#/shared/services/resourceList';
import type { Confirming } from '#/shared/use-cases/useConfirmedChange';
import { type Consent } from '#/pages/subjects/types/consent';
import { type Grant, type GrantsRevoked } from '#/pages/subjects/types/grant';
import type { SessionsEnded, SubjectSession } from '#/pages/subjects/types/subjectSession';
import { type Subject, subjectName } from '#/entities/subject';

// Sessions and grants are read and changed with manage-sessions alone:
// there is no view-sessions.
export function useHolds(tenant: string, capability: AdminCapability): boolean {
  return notLacking(useAuthority(tenant), [capability]);
}

export interface SubjectSessions {
  name: string;
  list: ResourceListState<SubjectSession>;
  end: Confirming<SubjectSession>;
  endAll: Confirming<'all'>;
}

export function useSubjectSessions(tenant: string, subject: Subject): SubjectSessions {
  const name = subjectName(subject);
  return {
    name,
    list: useSessionList(tenant, subject.id),
    end: useConfirmedSubjectChange({
      tenant,
      capability: 'manage-sessions',
      change: useEndSession(tenant, subject.id),
      done: () => sessionEndedText(name),
    }),
    endAll: useConfirmedSubjectChange({
      tenant,
      capability: 'manage-sessions',
      change: useEndAllSessions(tenant, subject.id),
      done: (_all, data: SessionsEnded) => sessionsEndedText(name, data.ended),
    }),
  };
}

export interface SubjectConsents {
  name: string;
  canManage: boolean;
  consents: ResourceListState<Consent>;
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
    consents: useConsentList(tenant, subject.id),
    revoke: useConfirmedSubjectChange({
      tenant,
      capability: 'manage-users',
      change: useRevokeConsent(tenant, subject.id),
      done: (consent) => consentRevokedText(name, consent.clientKey),
    }),
  };
}

export type { GrantClient };

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
  return {
    name,
    list,
    clients: grantClients(list.rows),
    revoke: useConfirmedSubjectChange({
      tenant,
      capability: 'manage-sessions',
      change: useRevokeGrants(tenant, subject.id),
      done: (client, data: GrantsRevoked) => grantsRevokedText(name, data.revoked, client.key),
    }),
  };
}
