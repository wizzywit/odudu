import { counted } from '#/shared/service/format.ts';

export function sessionEndedText(name: string): string {
  return `The session of ${name} ended.`;
}

export function sessionsEndedText(name: string, count: number): string {
  return `${counted(count, 'session', 'sessions')} of ${name} ended.`;
}

export function consentRevokedText(name: string, clientKey: string): string {
  return `${name}'s consent to ${clientKey} revoked.`;
}

export function grantsRevokedText(name: string, count: number, clientKey: string): string {
  return `${counted(count, 'grant', 'grants')} of ${name} through ${clientKey} revoked.`;
}

export interface GrantClient {
  id: string;
  key: string;
}

// Each client a listed grant was issued through, once: a revoke takes them all.
export function grantClients(
  grants: readonly { client_id: string; client_key: string }[],
): GrantClient[] {
  const clients = new Map(grants.map((grant) => [grant.client_id, grant.client_key]));
  return [...clients].map(([id, key]) => ({ id, key }));
}
