import { readMetadata } from '#/repository/metadata';
import type { Deps, ServerMetadata } from '#/types';

// Reads an issuer's metadata, checks that it names the issuer asked for (RFC
// 8414 section 3.3) and keeps it for an hour. The cache holds at most 256
// issuers, so a process serving every tenant of a large deployment stays
// bounded.
export function discover(issuer: string, deps: Deps = {}): Promise<ServerMetadata> {
  return readMetadata(issuer, deps);
}
