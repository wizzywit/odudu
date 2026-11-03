import type { Subject } from '#/entities/subject/types/subject';

// What a person-or-thing with an optional username is called: the username,
// else its id.
export function usernameOrId(named: { id: string; username: string | null }): string {
  return named.username ?? named.id;
}

// The name, else the kind and id ("service s2"), so a subject with no
// username still says what it is.
export function subjectName(subject: Pick<Subject, 'id' | 'type' | 'username'>): string {
  return subject.username ?? `${subject.type} ${subject.id}`;
}
