import { type Credential, type Lockout, type Profile, type Subject } from '@odudu/contracts/admin';
import { nameOrId } from '#/shared/services/ids';

export type { Credential, Lockout, Profile, Subject };

export function subjectName(subject: Pick<Subject, 'id' | 'type' | 'username'>): string {
  return nameOrId(subject, subject.type);
}
