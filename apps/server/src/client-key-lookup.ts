import { lookup } from 'node:dns/promises';

// The one DNS resolution a registered jwks_uri gets: every address a
// hostname answers to, handed to assertPublicAddresses before any of them
// is connected to, and then pinned — createClientKeyRequest never resolves
// the hostname itself. A hostname that fails to resolve at all yields no
// addresses, which clientKeySet already treats as nothing to connect to.
export function createClientKeyLookup(): (hostname: string) => Promise<readonly string[]> {
  return async (hostname) => {
    const records = await lookup(hostname, { all: true });
    return records.map((record) => record.address);
  };
}
