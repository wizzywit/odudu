import { holdingLabel, type Holding } from '#/shared/service/capabilities.ts';
import { andList } from '#/shared/service/format.ts';
import { type AdminCapability } from '#/shared/service/principal.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

// What a 403 or the last-administrator 409 means for a change to what a
// subject holds: a caller gives only what it holds itself, and reaches no
// subject holding more (ADR 0040). The guard's own detail is kept.
export function accessRefusal(
  name: string,
  what: 'groups' | 'roles' | 'actions',
  self = false,
): (problem: { type: string; status: number; detail?: string | undefined }) => string | null {
  return (problem) => {
    if (problem.status === 409 && problem.type === 'about:blank#last-administrator') {
      const who = self ? 'You are' : `${name} is`;
      const detail = problem.detail === undefined ? '' : ` (${problem.detail})`;
      return `${who} the last enabled administrator here, and this would take that away, so nothing was changed${detail}. Make somebody else an administrator first.`;
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

// What this console stops offering once a holding is gone.
const LOSS: Readonly<Record<Holding, string>> = {
  'tenant-admin': 'everything Full carries',
  'view-users': 'reading subjects',
  'manage-users': 'changing subjects',
  'manage-clients': 'changing clients',
  'manage-tenant': "changing this tenant's settings, roles, groups and scopes",
  'manage-keys': 'managing signing keys',
  'manage-sessions': 'ending sessions and revoking grants',
  'view-audit': 'reading the audit trail',
  'manage-tenants': 'reaching every other tenant',
};

export interface Confirmation {
  title: string;
  consequence: string;
  // Typed before it is confirmed, where the change reaches every tenant.
  typed: string | null;
}

// Asked before a save that takes admin capabilities from yourself, or takes
// manage-tenants from anybody: a plain save would land at once (§7.4).
export function removalConfirmation({
  name,
  self,
  removed,
  removesTenants,
}: {
  name: string;
  self: boolean;
  removed: readonly Holding[];
  removesTenants: boolean;
}): Confirmation | null {
  if (removed.length === 0 || (!self && !removesTenants)) return null;
  const lost = andList(removed.map(holdingLabel));
  const stops = andList(removed.map((holding) => LOSS[holding]));
  if (removesTenants) {
    return {
      title: self
        ? 'Revoke your own system administration?'
        : `Take system administration from ${name}?`,
      consequence: self
        ? `You are taking ${lost} from yourself, and with manage-tenants every other tenant. Once it lands this console stops offering ${stops}, and only another system administrator can give it back.`
        : `${name} loses ${lost}, and with manage-tenants every other tenant. Their other roles are kept; a holding through a group or a role that nests it stays until it is changed there.`,
      typed: name,
    };
  }
  return {
    title: 'Remove your own admin capabilities?',
    consequence: `You are taking ${lost} from yourself. Once it lands this console stops offering ${stops}, unless a group or another role still gives it to you, and you cannot give it back yourself.`,
    typed: null,
  };
}

export function onlyHolderText(name: string, tenant: string, counted: string): string {
  return `${name} is the only enabled holder of ${counted}, so ${tenant} would be left with nobody holding it. Give it to somebody else first.`;
}

export function changeFailureText(failure: GatewayFailure, capability: AdminCapability): string {
  switch (failure.kind) {
    case 'network':
      return 'Could not confirm the result. Nothing was sent again; the tab shows what the server holds now.';
    case 'schema':
      return 'It may have happened, but the answer could not be read. The tab shows what the server holds now.';
    case 'defect':
      return 'The console could not finish. This is a fault in the console, not something you did.';
    case 'problem':
      if (failure.problem.status === 403) {
        return `Refused: it needs the ${capability} capability, or the subject holds an admin capability you do not.`;
      }
      if (failure.problem.status === 404) return 'It is already gone.';
      return `Refused: ${failure.problem.detail ?? failure.problem.title}`;
  }
}
