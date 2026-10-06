import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { beyondCaller, heldCapabilities } from '#/shared/service/capabilities';
import { andList } from '#/shared/service/format.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

// What a subject's capabilities read answered, as the console holds it.
export type HeldRead =
  | { status: 'loading' }
  | { status: 'ready'; data: { items: readonly EffectiveRoleAssignment[] } }
  | { status: 'failed'; refused: boolean; retry: () => void };

// Every write on a client takes the client's service account over, so each is
// held to the ceiling on that subject (ADR 0040): refused when it holds an
// admin capability the caller lacks. A client with no service account has none.
export type Reach =
  | { status: 'free' }
  | { status: 'checking' }
  | { status: 'unreadable'; refused: boolean; retry: () => void }
  | { status: 'ready'; beyond: readonly AdminCapability[] };

export function clientReach(
  client: { service_subject_id: string | null } | undefined,
  held: HeldRead,
  caller: readonly AdminCapability[] | undefined,
): Reach {
  if (client === undefined) return { status: 'checking' };
  if (client.service_subject_id === null) return { status: 'free' };
  if (held.status === 'failed') {
    return { status: 'unreadable', refused: held.refused, retry: held.retry };
  }
  if (held.status === 'loading' || caller === undefined) return { status: 'checking' };
  return {
    status: 'ready',
    beyond: beyondCaller([...heldCapabilities(held.data.items).keys()], caller),
  };
}

// Nothing is offered until the ceiling is judged; `lacking` is whatever whoami
// says the caller is missing for the write itself.
export function canChange(reach: Reach, lacking: readonly AdminCapability[]): boolean {
  if (lacking.length > 0) return false;
  return reach.status === 'free' || (reach.status === 'ready' && reach.beyond.length === 0);
}

// The one line under the header; none while the answer is awaited or holds nothing back.
export function reachLine(reach: Reach, name: string): string | null {
  switch (reach.status) {
    case 'free':
    case 'checking':
      return null;
    case 'ready':
      return reach.beyond.length === 0
        ? null
        : `${name}'s service account holds ${andList(reach.beyond)}, which you do not, so you cannot change ${name}.`;
    case 'unreadable':
      return reach.refused
        ? `What ${name}'s service account holds decides whether you may change it, and reading that needs view-users, which you do not hold. Nothing here can be changed.`
        : `What ${name}'s service account holds could not be read, so nothing here can be changed until it is.`;
  }
}
