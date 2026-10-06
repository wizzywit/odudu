import type { Client } from '@odudu/contracts/admin';
import { beyondCaller } from '#/shared/service/capabilities';
import { andList } from '#/shared/service/format.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

// Every write on a client takes the client's service account over, so each is
// held to the ceiling on that subject (ADR 0040): refused when it holds an
// admin capability the caller lacks. The record carries what it holds, so the
// ceiling is judged from the record and the caller's own capabilities alone.
// A client with no service account has none.
export type Reach =
  | { status: 'free' }
  | { status: 'checking' }
  | { status: 'ready'; beyond: readonly AdminCapability[] };

export function clientReach(
  client: Pick<Client, 'service_subject_id' | 'service_account_admin_reach'> | undefined,
  caller: readonly AdminCapability[] | undefined,
): Reach {
  if (client === undefined) return { status: 'checking' };
  if (client.service_subject_id === null) return { status: 'free' };
  if (caller === undefined) return { status: 'checking' };
  return { status: 'ready', beyond: beyondCaller(client.service_account_admin_reach, caller) };
}

// Nothing is offered until the ceiling is judged; `lacking` is whatever whoami
// says the caller is missing for the write itself.
export function canChange(reach: Reach, lacking: readonly AdminCapability[]): boolean {
  if (lacking.length > 0) return false;
  return reach.status === 'free' || (reach.status === 'ready' && reach.beyond.length === 0);
}

// The one line under the header; none while the answer is awaited or holds nothing back.
export function reachLine(reach: Reach, name: string | undefined): string | null {
  if (reach.status !== 'ready' || reach.beyond.length === 0 || name === undefined) return null;
  return `${name}'s service account holds ${andList(reach.beyond)}, which you do not, so you cannot change ${name}.`;
}
