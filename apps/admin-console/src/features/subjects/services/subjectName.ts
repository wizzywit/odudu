import { type Profile } from '@odudu/contracts/admin';
import { nameOrId } from '#/shared/services/ids';
import { type Credential } from '#/features/subjects/types/credential';
import { type Lockout } from '#/features/subjects/types/lockout';
import { type Subject } from '#/entities/subject';

export type { Credential, Lockout, Profile, Subject };

export function subjectName(subject: Pick<Subject, 'id' | 'type' | 'username'>): string {
  return nameOrId(subject, subject.type);
}
