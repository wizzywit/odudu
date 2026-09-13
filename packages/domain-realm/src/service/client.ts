import { type ClientRecord } from '#/schema/clients';

// The comparison function is injected rather than imported: domain-realm must
// not depend on domain-identity, which is where the Argon2id verifier lives.
// The server wires the two together.
export async function verifyClientSecret(
  client: ClientRecord,
  presented: string | null,
  compare: (hash: string, secret: string) => Promise<boolean>,
): Promise<boolean> {
  if (!client.enabled) return false;
  if (client.type === 'public') return presented === null;
  if (presented === null || client.secretHash === null) return false;
  return compare(client.secretHash, presented);
}
