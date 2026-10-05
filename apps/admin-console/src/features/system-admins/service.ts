import type { Subject } from '@odudu/contracts/admin';
import { blockedChanges, lacking, type Change } from '#/shared/service/access.ts';
import {
  ADMINISTRATOR_REQUEST_NEEDS,
  administratorNeeds,
  GRANT_NEEDS,
  type AdministratorRequest,
} from '#/shared/service/administrators.ts';
import { writeFailureText } from '#/shared/service/failure.ts';
import { holdingLabel, isHolding } from '#/shared/service/capabilities.ts';
import { SYSTEM_TENANT, type AdminCapability, type Authority } from '#/shared/service/principal.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

export type { Subject };

export function subjectName(subject: Pick<Subject, 'id' | 'username'>): string {
  return subject.username ?? subject.id;
}

const CREATING = administratorNeeds(SYSTEM_TENANT, { subjectId: null, granted: false });

export interface AdministratorsAccess {
  createNeeds: readonly AdminCapability[];
  // What changing anybody's capabilities needs that whoami says is missing.
  changeNeeds: readonly AdminCapability[];
  // The changes whoami rules out, for the page's one line.
  blocked: Change | null;
}

export function administratorsAccess(authority: Authority | undefined): AdministratorsAccess {
  return {
    createNeeds: lacking(authority, CREATING),
    changeNeeds: lacking(authority, ['manage-users']),
    blocked: blockedChanges(authority, [
      { change: 'create them', needs: CREATING },
      { change: 'change what they hold', needs: GRANT_NEEDS },
    ]),
  };
}

// A subject holding something already is changed in the list, not given it again.
export function pickerUnavailable(
  holders: ReadonlySet<string> | null,
  subject: Pick<Subject, 'id'>,
): string | null {
  return holders?.has(subject.id) === true
    ? 'already holds a capability: change it in the list'
    : null;
}

export function choosable(
  id: string | null,
  holders: ReadonlySet<string> | null,
  options: readonly Subject[],
): Subject | null {
  if (id === null || holders?.has(id) === true) return null;
  return options.find((option) => option.id === id) ?? null;
}

export function grantFailureText(
  name: string,
  refused: { failure: GatewayFailure; request: AdministratorRequest },
): string {
  const { failure, request } = refused;
  switch (failure.kind) {
    case 'network':
      return `Could not confirm whether ${name} was given it. Check the list before trying again.`;
    case 'schema':
      return `${name} may have been given it, but the answer could not be read. Check the list.`;
    case 'defect':
      return writeFailureText(failure, { name, verb: 'given it', lookAt: 'the list' });
    case 'problem': {
      const { problem } = failure;
      const why =
        problem.status === 403
          ? (problem.detail ?? `it needs the ${ADMINISTRATOR_REQUEST_NEEDS[request]} capability`)
          : problem.status === 412
            ? 'their roles changed while this ran. Try again'
            : (problem.detail ?? problem.title);
      return `${name} was not given it: ${why}.`;
    }
  }
}

export function grantedText(name: string, holdings: readonly string[]): string {
  return `${name} now holds ${holdings.filter(isHolding).map(holdingLabel).join(', ')} in system.`;
}
