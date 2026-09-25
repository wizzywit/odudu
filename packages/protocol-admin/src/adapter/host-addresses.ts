import { lookup } from 'node:dns/promises';
import { type ResolveHost } from '#/service/smtp-destination';

/** Every address the resolver returns, not the first — ADR 0028 checks all of them. */
export const resolveHostAddresses: ResolveHost = async (host) => {
  const results = await lookup(host, { all: true });
  return results.map((result) => result.address);
};
