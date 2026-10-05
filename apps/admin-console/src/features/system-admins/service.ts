import type { Subject } from '@odudu/contracts/admin';

export type { Subject };

export function subjectName(subject: Pick<Subject, 'id' | 'username'>): string {
  return subject.username ?? subject.id;
}
