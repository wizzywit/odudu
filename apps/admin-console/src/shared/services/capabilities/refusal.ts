import { andList } from '#/shared/services/format';
import { type AdminCapability } from '#/shared/services/principal';

// The capabilities one part of a ceiling refusal's detail names after `lead`.
function namedAfter(parts: readonly string[], lead: string): string[] {
  const part = parts.find((each) => each.startsWith(lead));
  return part === undefined ? [] : part.slice(lead.length).split(', ');
}

export interface RefusalProblem {
  type: string;
  status: number;
  detail?: string | undefined;
}

// The server's guard against leaving a tenant with no enabled administrator.
export function isLastAdministrator(problem: RefusalProblem): boolean {
  return problem.status === 409 && problem.type === 'about:blank#last-administrator';
}

// The guard's own detail, appended to the sentence that words it.
export function detailSuffix(problem: RefusalProblem): string {
  return problem.detail === undefined ? '' : ` (${problem.detail})`;
}

// What a group, role or scope write refused by its guards means, worded
// where it was made; the server's own reason is kept when it is not the
// capability ceiling's (ADR 0040). Null for anything else.
export function writeRefusal(problem: RefusalProblem, capability = 'manage-tenant'): string | null {
  const detail = problem.detail;
  if (isLastAdministrator(problem)) {
    return `Refused: it would leave this tenant with no enabled administrator${detailSuffix(problem)}. Make somebody else an administrator first.`;
  }
  if (problem.status !== 403) return null;
  if (detail === undefined || detail === '') {
    return `Refused: it needs the ${capability} capability, or reaches a capability you do not hold.`;
  }
  const parts = detail.split('; ');
  const granted = namedAfter(parts, 'the caller does not hold: ');
  const removed = namedAfter(parts, 'this removes capabilities the caller does not hold: ');
  if (granted.length + removed.length === 0) return `Refused: ${detail}.`;
  const would = [
    ...(granted.length === 0 ? [] : [`hand out ${andList(granted)}`]),
    ...(removed.length === 0
      ? []
      : [`take ${andList(removed)} from whoever holds it through here`]),
  ];
  const tail =
    granted.length + removed.length > 1
      ? 'none of which you hold yourself'
      : 'which you do not hold yourself';
  return `Refused: it would ${would.join(' and ')}, ${tail}.`;
}

// What a 403 or the last-administrator 409 means for a change to what a
// subject holds: a caller gives only what it holds itself, and reaches no
// subject holding more (ADR 0040). The guard's own detail is kept.
export function accessRefusal(
  name: string,
  what: 'groups' | 'roles' | 'actions',
  self = false,
): (problem: RefusalProblem) => string | null {
  return (problem) => {
    if (isLastAdministrator(problem)) {
      const who = self ? 'You are' : `${name} is`;
      return `${who} the last enabled administrator here, and this would take that away, so nothing was changed${detailSuffix(problem)}. Make somebody else an administrator first.`;
    }
    if (problem.status !== 403) return null;
    const ceiling = `nor can you change a subject who holds a capability you do not. It also needs manage-users.`;
    switch (what) {
      case 'groups':
        return `Refused: a group's roles are granted with it, and you can grant only capabilities you hold yourself; ${ceiling}`;
      case 'roles':
        return `Refused: you can give or take only what you hold yourself, nested in a role or not; ${ceiling}`;
      case 'actions':
        return `Refused: it needs manage-users, and ${name} may hold a capability you do not.`;
    }
  };
}

// Why a 403 on a subject can mean the caller's own ceiling and not only a missing capability.
export function subjectRefusal(who: string, capability: AdminCapability): string {
  return `it needs the ${capability} capability, or ${who} holds an admin capability you do not.`;
}
