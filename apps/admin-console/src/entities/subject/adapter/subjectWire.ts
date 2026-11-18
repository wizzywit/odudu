import type {
  ListedSubject as WireListed,
  Subject as WireSubject,
  SubjectDetail as WireDetail,
} from '@odudu/contracts/admin';
import type { ListedSubject, Subject } from '#/entities/subject/types/subject';

export function subjectOf(wire: WireSubject): Subject {
  return {
    id: wire.id,
    type: wire.type,
    username: wire.username,
    email: wire.email,
    enabled: wire.enabled,
    createdAt: wire.created_at,
  };
}

export function listedSubjectOf(wire: WireListed): ListedSubject {
  return { ...subjectOf(wire), adminCapabilities: wire.admin_capabilities };
}

export function subjectDetailOf(wire: WireDetail): Subject {
  return { ...subjectOf(wire), pendingEmail: wire.pending_email ?? null };
}
