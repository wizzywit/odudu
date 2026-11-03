import type { Role } from '#/entities/role';
import {
  ADMIN_CLIENT_KEY,
  beyondCaller,
  lossText,
  type Loss,
  writeRefusal,
} from '#/shared/lib/services/capabilities';
import { andList } from '#/shared/lib/services/format';
import { type AdminCapability } from '#/shared/lib/services/principal';
import { writeFailureText } from '#/shared/lib/services/failure';
import { type GatewayFailure } from '#/shared/lib/services/result';

// Every role of the built-in admin client, which the server guards by the
// client rather than by the role's name.
export function isBuiltin(role: Pick<Role, 'client_key'>): boolean {
  return role.client_key === ADMIN_CLIENT_KEY;
}

// `admin_reach` is the server's judgement of what a role hands out, however
// deep it nests a capability: the same one each ceiling on its writes makes.
export function deleteBlock(role: Role, caller: readonly AdminCapability[]): string | null {
  if (isBuiltin(role)) {
    return deletionFixed(role);
  }
  const beyond = beyondCaller(role.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `${role.name} reaches ${andList(beyond)}, which you do not hold, so you cannot delete it.`;
}

export function deletionFixed(role: Role): string | null {
  return isBuiltin(role)
    ? `${role.name} is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.`
    : null;
}

export function roleDeleteConsequence(name: string, loss: Loss): string {
  return `${name} is taken from every subject, group and scope it is given to, and out of every role it is nested in; what it nests is no longer held through it. It cannot be undone.${lossText(loss, name)}`;
}

export function roleDeleteFailureText(name: string, failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name,
    verb: 'deleted',
    lookAt: 'the roles',
    refused: (problem) =>
      problem.status === 409 && problem.detail !== undefined
        ? `Refused: ${problem.detail}.`
        : writeRefusal(problem),
  });
}
