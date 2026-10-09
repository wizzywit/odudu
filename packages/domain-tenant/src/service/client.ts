import { type ClientRecord } from '#/schema/clients';

// The comparison function is injected rather than imported: domain-tenant must
// not depend on domain-identity, which is where the Argon2id verifier lives.
// The server wires the two together. A rotated-out secret still answers
// until its window ends at `now`, and not from that instant on. A wrong
// secret costs a second comparison while one is kept, which tells a caller
// the per-client limiter already bounds only that a rotation is under way.
export async function verifyClientSecret(
  client: ClientRecord,
  presented: string | null,
  compare: (hash: string, secret: string) => Promise<boolean>,
  now: Date,
): Promise<boolean> {
  if (!client.enabled) return false;
  if (client.type === 'public') return presented === null;
  if (presented === null || client.secretHash === null) return false;
  if (await compare(client.secretHash, presented)) return true;
  const previous = client.previousSecretHash;
  const until = client.previousSecretExpiresAt;
  if (previous === null || until === null || until.getTime() <= now.getTime()) return false;
  return compare(previous, presented);
}
