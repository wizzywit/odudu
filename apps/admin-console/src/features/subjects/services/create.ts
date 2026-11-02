import { lacking } from '#/shared/services/access';
import { createdText, type CreateSpec } from '#/shared/services/failure';
import { type Authority } from '#/shared/services/principal';

export function subjectCreatedText(name: string): string {
  return `${createdText(name)} It has no password yet: issue a one-time password from its Credentials tab.`;
}

export function newSubjectSpec(name: string): CreateSpec {
  return {
    noun: 'subject',
    name,
    fields: ['username', 'email'],
    capability: 'manage-users',
    schema: `${name} may have been created, but the answer could not be read. Look for it.`,
    refused: (problem) =>
      problem.status === 403
        ? `${name} was not created: it needs the manage-users capability.`
        : null,
  };
}

// Offered only while whoami says nothing rules creating out.
// What creating needs that whoami says is missing; none before it answers.
export function manageUsersRefusal(authority: Authority | undefined): 'manage-users' | null {
  return lacking(authority, ['manage-users']).length === 0 ? null : 'manage-users';
}
